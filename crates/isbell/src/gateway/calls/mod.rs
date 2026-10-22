//! Calls in flight and the streams they open: each call runs as a task that replies through its
//! caller's link, and each open stream is registered so the caller's input reaches it. Calls belong
//! to the gateway process, not to a relay connection, so a result finished after a reconnect still
//! reaches its caller.

mod route;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use isbell_proto::frame::{Frame, RpcError};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

pub use self::route::methods;
use self::route::{Inbound, Method, output_frame, response_frame, route};
use super::file;
use super::link::Link;
use super::stream::{Input, Output};
use super::terminal::{self, TerminalRequest};
use super::{HerdrSlot, nudge, rpc};

/// Open terminals and files together.
const MAX_STREAMS: usize = 8;
/// Queued caller input per stream; input beyond this is dropped while the stream lags.
const STREAM_INPUT_BUFFER: usize = 256;

fn unavailable() -> RpcError {
    RpcError::new("herdr_unavailable", "herdr server is not available")
}

/// A stream by its caller (the link's key) and call id.
type StreamKey = (String, u64);

/// Open streams, for routing client input to them.
type Streams = Arc<Mutex<HashMap<StreamKey, mpsc::Sender<Input>>>>;

/// Calls in flight; they outlive relay connections, since each replies through its caller's link.
pub struct Calls {
    tasks: JoinSet<()>,
    streams: Streams,
    slot: HerdrSlot,
    refresh: mpsc::Sender<()>,
}

impl Calls {
    pub fn new(slot: HerdrSlot, refresh: mpsc::Sender<()>) -> Calls {
        Calls { tasks: JoinSet::new(), streams: Arc::default(), slot, refresh }
    }

    /// Acts on one frame from `link`'s caller: a call starts a task, stream input feeds its stream.
    pub fn handle(&mut self, link: Link, frame: Frame) {
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
    pub fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "request task failed");
            }
        }
    }

    fn start(&mut self, link: Link, id: u64, method: Method, p: Value) {
        let herdr = self.slot.read().expect("herdr slot poisoned").clone().ok_or_else(unavailable);
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
                self.tasks.spawn(serve_stream(link, id, Arc::clone(&self.streams), open, run))
            }
            Method::FileRead => {
                let run = |file, input, emit| file::pump_read(file, input, emit);
                let streams = Arc::clone(&self.streams);
                self.tasks.spawn(serve_stream(link, id, streams, file::open_read(p), run))
            }
        };
    }
}

fn bad_request(err: serde_json::Error) -> RpcError {
    RpcError::new("bad_request", err.to_string())
}

/// Delivers a stream's output to its caller.
type Emit = Box<dyn FnMut(Output) + Send>;

/// Registers the stream, opens it, answers the call, then runs the stream until either side ends
/// it. Registered before the answer so input sent right after it is not lost.
async fn serve_stream<S, R: Future<Output = ()>>(
    link: Link,
    id: u64,
    streams: Streams,
    open: impl Future<Output = Result<(S, Value), RpcError>>,
    run: impl FnOnce(S, mpsc::Receiver<Input>, Emit) -> R,
) {
    let opened = async {
        let (registered, input) = register(&streams, (link.key().to_owned(), id))?;
        let (stream, r) = open.await?;
        Ok::<_, RpcError>((registered, input, stream, r))
    };
    match opened.await {
        Err(err) => link.send(response_frame(id, Err(err))),
        Ok((_registered, input, stream, r)) => {
            link.send(response_frame(id, Ok(r)));
            let caller = link.clone();
            run(stream, input, Box::new(move |output| caller.send(output_frame(id, output)))).await;
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
    if open.len() >= MAX_STREAMS {
        return Err(RpcError::new("too_many_streams", "too many open streams"));
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
        Some(Err(err)) => tracing::warn!(id, %err, "stream input dropped"),
        None => tracing::debug!(id, "input for an unknown stream"),
    }
}
