//! Calls in flight and the streams they open: each call runs as a task, and each open stream is
//! registered so client input reaches it. Calls belong to the gateway process, not to a relay
//! connection: their frames are addressed to the caller's connection, so a result finished after a
//! reconnect still reaches its caller.

mod route;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use isbell_proto::frame::{Frame, RpcError};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

pub use self::route::methods;
use self::route::{Inbound, Method, StreamKey, output_frame, response_frame, route};
use super::herdr::Herdr;
use super::terminal::{self, Input, TerminalRequest};
use super::{HerdrSlot, nudge, rpc};

/// Queued client input per stream; keystrokes beyond this are dropped while the session lags.
const STREAM_INPUT_BUFFER: usize = 256;

fn unavailable() -> RpcError {
    RpcError::new("herdr_unavailable", "herdr server is not available")
}

/// Open streams, for routing client input to them.
type Streams = Arc<Mutex<HashMap<StreamKey, mpsc::Sender<Input>>>>;

/// Calls in flight and where their frames go; outlives relay connections.
pub struct Calls {
    tasks: JoinSet<()>,
    out: mpsc::UnboundedSender<Frame>,
    streams: Streams,
    slot: HerdrSlot,
    refresh: mpsc::Sender<()>,
}

impl Calls {
    /// Also returns the receiving end of the calls' frames, for the relay connection to drain.
    pub fn new(
        slot: HerdrSlot,
        refresh: mpsc::Sender<()>,
    ) -> (Calls, mpsc::UnboundedReceiver<Frame>) {
        let (out, rx) = mpsc::unbounded_channel();
        (Calls { tasks: JoinSet::new(), out, streams: Arc::default(), slot, refresh }, rx)
    }

    /// Acts on one frame from the relay: a call starts a task, stream input feeds its stream.
    pub fn handle(&mut self, frame: Frame) {
        match route(frame) {
            Inbound::Call { id, to, method: Ok(method), p } => self.start(id, to, method, p),
            Inbound::Call { id, to, method: Err(m), .. } => {
                let unknown = RpcError::new("method_not_allowed", format!("unknown method {m}"));
                send(&self.out, response_frame(id, to, Err(unknown)));
            }
            Inbound::Input { key, input } => feed(&self.streams, key, input),
            Inbound::Ignore(what) => tracing::debug!(what, "ignoring a frame from the relay"),
        }
    }

    /// Collects finished calls, logging any that panicked.
    pub fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "request task failed");
            }
        }
    }

    fn start(&mut self, id: u64, to: String, method: Method, p: Value) {
        let herdr = self.slot.read().expect("herdr slot poisoned").clone().ok_or_else(unavailable);
        let out = self.out.clone();
        match method {
            Method::Herdr => self.tasks.spawn(async move {
                let result = async { rpc::passthrough(&herdr?, p).await }.await;
                send(&out, response_frame(id, to, result));
            }),
            Method::StartAgent => {
                let refresh = self.refresh.clone();
                self.tasks.spawn(async move {
                    let result = async { rpc::start_agent(&herdr?, p).await }.await;
                    nudge(&refresh);
                    send(&out, response_frame(id, to, result));
                })
            }
            Method::Terminal => {
                let streams = Arc::clone(&self.streams);
                self.tasks.spawn(stream_terminal(herdr, id, to, p, out, streams))
            }
        };
    }
}

fn send(out: &mpsc::UnboundedSender<Frame>, frame: Frame) {
    if out.send(frame).is_err() {
        tracing::debug!("gateway stopped before a call's frame was sent");
    }
}

/// Opens a terminal session and streams it to the caller until either side ends it.
async fn stream_terminal(
    herdr: Result<Herdr, RpcError>,
    id: u64,
    to: String,
    p: Value,
    out: mpsc::UnboundedSender<Frame>,
    streams: Streams,
) {
    let opened = async {
        let herdr = herdr?;
        let req: TerminalRequest = serde_json::from_value(p)
            .map_err(|err| RpcError::new("bad_request", err.to_string()))?;
        // Registered before the response so input sent right after it is not lost.
        let (registered, input) = register(&streams, (to.clone(), id))?;
        let (session, r) = terminal::open(&herdr, req).await?;
        Ok((registered, input, session, r))
    };
    match opened.await {
        Err(err) => send(&out, response_frame(id, to, Err(err))),
        Ok((_registered, input, session, r)) => {
            send(&out, response_frame(id, to.clone(), Ok(r)));
            terminal::pump(session, input, |output| send(&out, output_frame(id, &to, output)))
                .await;
        }
    }
}

/// A stream's entry in the registry, removed when dropped.
struct Registered {
    streams: Streams,
    key: StreamKey,
}

impl Drop for Registered {
    fn drop(&mut self) {
        self.streams.lock().expect("streams poisoned").remove(&self.key);
    }
}

fn register(
    streams: &Streams,
    key: StreamKey,
) -> Result<(Registered, mpsc::Receiver<Input>), RpcError> {
    let mut open = streams.lock().expect("streams poisoned");
    if open.len() >= terminal::MAX_TERMINALS {
        return Err(RpcError::new("too_many_terminals", "too many open terminals"));
    }
    let (tx, rx) = mpsc::channel(STREAM_INPUT_BUFFER);
    open.insert(key.clone(), tx);
    Ok((Registered { streams: Arc::clone(streams), key }, rx))
}

fn feed(streams: &Streams, key: StreamKey, input: Input) {
    let id = key.1;
    let stream = streams.lock().expect("streams poisoned").get(&key).cloned();
    match stream.map(|tx| tx.try_send(input)) {
        Some(Ok(())) => {}
        Some(Err(err)) => tracing::warn!(id, %err, "terminal input dropped"),
        None => tracing::debug!(id, "input for an unknown stream"),
    }
}
