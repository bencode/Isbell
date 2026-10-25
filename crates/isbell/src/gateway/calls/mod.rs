//! Calls in flight and the streams they open: each call runs as a task that replies through its
//! caller's link, and each open stream is registered so the caller's input reaches it. Calls belong
//! to the gateway process, not to a relay connection or a direct link, so a result finished after a
//! reconnect still reaches its caller. One task owns them; relayed and direct frames both reach it
//! through its inbox.

mod route;
mod streams;

use std::sync::Arc;

use isbell_proto::frame::{Frame, RpcError};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

pub use self::route::methods;
pub(super) use self::route::response_frame;
use self::route::{Inbound, Method, route};
use self::streams::{Emit, Streams, close_caller, feed, register, serve_stream};
use super::herdr::HerdrError;
use super::link::Link;
use super::stream::Input;
use super::terminal;
use super::{HerdrSlot, direct, file, nudge, rpc};

/// What reaches the calls: a frame from a caller, or the end of a direct caller's link.
pub enum ToCalls {
    Frame(Link, Box<Frame>),
    Gone(String),
}

/// Owns the calls: acts on each message and collects finished tasks.
pub async fn run(mut calls: Calls, mut inbox: mpsc::UnboundedReceiver<ToCalls>) {
    while let Some(message) = inbox.recv().await {
        calls.reap();
        match message {
            ToCalls::Frame(link, frame) => calls.handle(link, *frame),
            ToCalls::Gone(key) => close_caller(&calls.streams, &key),
        }
    }
}

/// Calls in flight; they outlive relay connections, since each replies through its caller's link.
pub struct Calls {
    tasks: JoinSet<()>,
    streams: Streams,
    slot: HerdrSlot,
    refresh: mpsc::Sender<()>,
    /// STUN servers for direct links.
    ice: Vec<String>,
    /// The calls' own inbox, for the frames of direct links.
    inbox: mpsc::UnboundedSender<ToCalls>,
}

impl Calls {
    pub fn new(
        slot: HerdrSlot,
        refresh: mpsc::Sender<()>,
        ice: Vec<String>,
        inbox: mpsc::UnboundedSender<ToCalls>,
    ) -> Calls {
        Calls { tasks: JoinSet::new(), streams: Arc::default(), slot, refresh, ice, inbox }
    }

    /// Acts on one frame from `link`'s caller: a call starts a task, stream input feeds its stream.
    fn handle(&mut self, link: Link, frame: Frame) {
        match route(frame) {
            Inbound::Call { id, method: Ok(method), p } => self.start(link, id, method, p),
            Inbound::Call { id, method: Err(m), .. } => {
                let unknown = RpcError::new("method_not_allowed", format!("unknown method {m}"));
                link.send(response_frame(id, Err(unknown)));
            }
            Inbound::Input { id, input } => feed(&self.streams, (link.key().to_owned(), id), input),
            Inbound::Ignore(what) => tracing::debug!(what, "ignoring a frame from a caller"),
        }
    }

    /// Collects finished calls, logging any that panicked.
    fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "request task failed");
            }
        }
    }

    fn start(&mut self, link: Link, id: u64, method: Method, p: Value) {
        let herdr = self.slot.read().expect("herdr slot poisoned").clone();
        let herdr = herdr.ok_or_else(|| {
            RpcError::from(HerdrError::unavailable("herdr server is not available"))
        });
        match method {
            Method::Herdr => {
                self.tasks.spawn(async move {
                    let result = async { rpc::passthrough(&herdr?, p).await }.await;
                    link.send(response_frame(id, result));
                });
            }
            Method::StartAgent => {
                let refresh = self.refresh.clone();
                self.tasks.spawn(async move {
                    let result = async { rpc::start_agent(&herdr?, p).await }.await;
                    nudge(&refresh);
                    link.send(response_frame(id, result));
                });
            }
            Method::History => {
                self.tasks.spawn(async move {
                    let result = async { rpc::history(&herdr?, p).await }.await;
                    link.send(response_frame(id, result));
                });
            }
            Method::Terminal => {
                let open = async move { terminal::open(&herdr?, p).await };
                self.stream(link, id, open, terminal::pump);
            }
            Method::FileRead => self.stream(link, id, file::open_read(p), file::pump_read),
            Method::FileWrite => self.stream(link, id, file::open_write(p), file::pump_write),
            Method::RtcOffer => {
                let (ice, inbox) = (self.ice.clone(), self.inbox.clone());
                self.tasks.spawn(direct::serve(link, id, p, ice, inbox));
            }
        }
    }

    /// Registers the stream now, in order with its caller's other frames, so the caller's `Gone`
    /// always finds it; then opens and runs it in a task.
    fn stream<S, R>(
        &mut self,
        link: Link,
        id: u64,
        open: impl Future<Output = Result<(S, Value), RpcError>> + Send + 'static,
        run: impl FnOnce(S, mpsc::Receiver<Input>, Emit) -> R + Send + 'static,
    ) where
        S: Send + 'static,
        R: Future<Output = ()> + Send + 'static,
    {
        match register(&self.streams, (link.key().to_owned(), id)) {
            Ok(slot) => {
                self.tasks.spawn(serve_stream(link, id, slot, open, run));
            }
            Err(err) => link.send(response_frame(id, Err(err))),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use isbell_proto::frame::Header;
    use serde_json::json;

    use super::*;

    /// A caller's last stream opens just before its direct link ends: the link's end still closes
    /// it, rather than leaving it to its idle timeout.
    #[tokio::test]
    async fn a_gone_caller_loses_even_the_stream_it_just_opened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, b"# notes").unwrap();
        let (inbox, inbox_rx) = mpsc::unbounded_channel();
        let (refresh, _refresh_rx) = mpsc::channel(1);
        let calls = Calls::new(HerdrSlot::default(), refresh, vec![], inbox.clone());
        let streams = Arc::clone(&calls.streams);
        let _calls = crate::AbortOnDrop(tokio::spawn(run(calls, inbox_rx)));

        let (out, mut out_rx) = mpsc::unbounded_channel();
        let link = Link::peer("peer-1".into(), out);
        let p = json!({"path": path});
        let call = Header::Call { id: 1, m: "isbell.file.read".into(), p, mid: None, from: None };
        inbox.send(ToCalls::Frame(link, Box::new(Frame::new(call)))).unwrap();
        inbox.send(ToCalls::Gone("peer-1".into())).unwrap();

        let answered = tokio::time::timeout(Duration::from_secs(2), out_rx.recv()).await;
        let answer = answered.expect("the call is answered").unwrap().header;
        assert!(matches!(answer, Header::Res { id: 1, ok: true, .. }), "the stream opened");
        let closed = async {
            while !streams.lock().expect("streams poisoned").is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(2), closed).await.expect("the stream closes");
    }
}
