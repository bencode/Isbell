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
use self::streams::{Streams, close_caller, feed, serve_stream};
use super::link::Link;
use super::terminal::{self, TerminalRequest};
use super::{HerdrSlot, direct, file, nudge, rpc};

fn unavailable() -> RpcError {
    RpcError::new("herdr_unavailable", "herdr server is not available")
}

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
        let herdr = self.slot.read().expect("herdr slot poisoned").clone().ok_or_else(unavailable);
        let streams = Arc::clone(&self.streams);
        match method {
            Method::Herdr => self.tasks.spawn(async move {
                let result = async { rpc::passthrough(&herdr?, p).await }.await;
                link.send(response_frame(id, result));
            }),
            Method::StartAgent => {
                let refresh = self.refresh.clone();
                self.tasks.spawn(async move {
                    let result = async { rpc::start_agent(&herdr?, p).await }.await;
                    nudge(&refresh);
                    link.send(response_frame(id, result));
                })
            }
            Method::Terminal => {
                let open = async move {
                    let herdr = herdr?;
                    let req: TerminalRequest = serde_json::from_value(p).map_err(bad_request)?;
                    terminal::open(&herdr, req).await
                };
                let run = |session, input, emit| terminal::pump(session, input, emit);
                self.tasks.spawn(serve_stream(link, id, streams, open, run))
            }
            Method::FileRead => {
                let run = |file, input, emit| file::pump_read(file, input, emit);
                self.tasks.spawn(serve_stream(link, id, streams, file::open_read(p), run))
            }
            Method::FileWrite => {
                let run = |target, input, emit| file::pump_write(target, input, emit);
                self.tasks.spawn(serve_stream(link, id, streams, file::open_write(p), run))
            }
            Method::RtcOffer => {
                let (ice, inbox) = (self.ice.clone(), self.inbox.clone());
                self.tasks.spawn(direct::serve(link, id, p, ice, inbox))
            }
        };
    }
}

fn bad_request(err: serde_json::Error) -> RpcError {
    RpcError::new("bad_request", err.to_string())
}
