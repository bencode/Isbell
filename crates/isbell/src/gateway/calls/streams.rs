//! Open streams by caller and call id, so a caller's input reaches its stream; and the task that
//! serves one stream.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use isbell_proto::frame::RpcError;
use serde_json::Value;
use tokio::sync::mpsc;

use super::route::{output_frame, response_frame};
use crate::gateway::link::Link;
use crate::gateway::stream::{Input, Output};

/// Open terminals and files together.
const MAX_STREAMS: usize = 8;
/// Queued caller input per stream; input beyond this is dropped while the stream lags.
const STREAM_INPUT_BUFFER: usize = 256;

/// A stream by its caller (the link's key) and call id.
type StreamKey = (String, u64);

/// Open streams, for routing caller input to them.
pub type Streams = Arc<Mutex<HashMap<StreamKey, mpsc::Sender<Input>>>>;

/// Delivers a stream's output to its caller.
pub type Emit = Box<dyn FnMut(Output) + Send>;

/// Opens a registered stream, answers the call, then runs the stream until either side ends it.
/// The stream is registered before the answer, so input sent right after it is not lost.
pub async fn serve_stream<S, R: Future<Output = ()>>(
    link: Link,
    id: u64,
    slot: Slot,
    open: impl Future<Output = Result<(S, Value), RpcError>>,
    run: impl FnOnce(S, mpsc::Receiver<Input>, Emit) -> R,
) {
    let Slot { registered: _registered, input } = slot;
    match open.await {
        Err(err) => link.send(response_frame(id, Err(err))),
        Ok((stream, r)) => {
            link.send(response_frame(id, Ok(r)));
            let caller = link.clone();
            run(stream, input, Box::new(move |output| caller.send(output_frame(id, output)))).await;
        }
    }
}

/// A stream's place in the registry and its input; it leaves the registry when dropped.
pub struct Slot {
    registered: Registered,
    input: mpsc::Receiver<Input>,
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

/// Takes a place for the stream `key`, unless too many streams are open.
pub fn register(streams: &Streams, key: StreamKey) -> Result<Slot, RpcError> {
    let mut open = streams.lock().expect("streams poisoned");
    if open.len() >= MAX_STREAMS {
        return Err(RpcError::new("too_many_streams", "too many open streams"));
    }
    // Taking the place would leave the open stream unreachable, and its end would free ours.
    if open.contains_key(&key) {
        return Err(RpcError::bad_request("a stream with this id is open"));
    }
    let (tx, rx) = mpsc::channel(STREAM_INPUT_BUFFER);
    open.insert(key.clone(), tx);
    Ok(Slot { registered: Registered { streams: Arc::clone(streams), key }, input: rx })
}

pub fn feed(streams: &Streams, key: StreamKey, input: Input) {
    let id = key.1;
    let stream = streams.lock().expect("streams poisoned").get(&key).cloned();
    match stream.map(|tx| tx.try_send(input)) {
        Some(Ok(())) => {}
        Some(Err(err)) => tracing::warn!(id, %err, "stream input dropped"),
        None => tracing::debug!(id, "input for an unknown stream"),
    }
}

/// Closes every stream of the caller whose link is `key`: its link is gone.
pub fn close_caller(streams: &Streams, key: &str) {
    let open = streams.lock().expect("streams poisoned");
    for ((caller, id), tx) in open.iter().filter(|((caller, _), _)| caller == key) {
        if tx.try_send(Input::Close).is_err() {
            tracing::warn!(caller, id, "stream input full; it ends on its idle timeout");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_a_caller_closes_only_its_streams() {
        let streams = Streams::default();
        let mut mine = register(&streams, ("peer-1".into(), 1)).unwrap();
        let mut theirs = register(&streams, ("c1".into(), 1)).unwrap();
        close_caller(&streams, "peer-1");
        assert_eq!(mine.input.try_recv().unwrap(), Input::Close);
        assert!(theirs.input.try_recv().is_err(), "another caller's stream stays open");
    }

    #[test]
    fn an_open_stream_keeps_its_id() {
        let streams = Streams::default();
        let _open = register(&streams, ("c1".into(), 7)).unwrap();
        let again = register(&streams, ("c1".into(), 7)).err().expect("refused");
        assert_eq!(again.code, "bad_request");
        assert!(streams.lock().unwrap().contains_key(&("c1".into(), 7)), "the first stays");
    }
}
