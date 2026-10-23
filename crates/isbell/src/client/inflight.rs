//! Calls awaiting a response and open streams, by id. A machine that goes offline or restarts takes
//! its calls and streams with it, and so does a direct link that is lost; losing the relay
//! connection ends them all.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use isbell_proto::frame::RpcError;
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use super::stream::StreamEvent;

pub type Reply = Result<Value, RpcError>;

/// Where a call or stream went: the machine, its gateway process (`boot`) when known, and whether
/// it went over the direct link.
pub struct Target {
    pub mid: String,
    pub boot: Option<u64>,
    pub direct: bool,
}

struct Waiter {
    target: Target,
    tx: oneshot::Sender<Reply>,
}

struct StreamSlot {
    target: Target,
    tx: mpsc::UnboundedSender<StreamEvent>,
}

#[derive(Default)]
struct Entries {
    calls: HashMap<u64, Waiter>,
    streams: HashMap<u64, StreamSlot>,
}

/// Shared by a session, its streams and its read loop; empty for good once the connection is gone.
#[derive(Clone)]
pub struct Inflight(Arc<Mutex<Option<Entries>>>);

impl Inflight {
    pub fn new() -> Inflight {
        Inflight(Arc::new(Mutex::new(Some(Entries::default()))))
    }

    /// Runs `f` on the entries; `None` once the connection is gone.
    fn with<T>(&self, f: impl FnOnce(&mut Entries) -> T) -> Option<T> {
        self.0.lock().expect("session poisoned").as_mut().map(f)
    }

    pub fn add_call(
        &self,
        id: u64,
        target: Target,
        tx: oneshot::Sender<Reply>,
    ) -> Result<(), RpcError> {
        self.with(|e| e.calls.insert(id, Waiter { target, tx })).map(drop).ok_or_else(disconnected)
    }

    pub fn add_stream(
        &self,
        id: u64,
        target: Target,
        tx: mpsc::UnboundedSender<StreamEvent>,
    ) -> Result<(), RpcError> {
        let slot = StreamSlot { target, tx };
        self.with(|e| e.streams.insert(id, slot)).map(drop).ok_or_else(disconnected)
    }

    pub fn forget_call(&self, id: u64) {
        self.with(|e| e.calls.remove(&id));
    }

    pub fn forget_stream(&self, id: u64) {
        self.with(|e| e.streams.remove(&id));
    }

    /// Answers a call; a missing entry is a duplicate or late response nobody waits for.
    pub fn resolve(&self, id: u64, reply: Reply) {
        if let Some(waiter) = self.with(|e| e.calls.remove(&id)).flatten()
            && waiter.tx.send(reply).is_err()
        {
            tracing::debug!(id, "caller stopped waiting");
        }
    }

    /// Hands an event to an open stream; `last` also closes it.
    pub fn deliver(&self, id: u64, event: StreamEvent, last: bool) {
        let tx = self.with(|e| match last {
            true => e.streams.remove(&id).map(|s| s.tx),
            false => e.streams.get(&id).map(|s| s.tx.clone()),
        });
        if let Some(tx) = tx.flatten()
            && tx.send(event).is_err()
        {
            tracing::debug!(id, "stream reader is gone");
        }
    }

    /// Fails the calls and ends the streams matching `lost` with `err`. A gateway that reconnects
    /// to the relay keeps serving them; only one that went offline or restarted loses them, or a
    /// direct link that is gone.
    pub fn fail(&self, err: RpcError, lost: impl Fn(&Target) -> bool) {
        self.with(|e| {
            for (id, waiter) in e.calls.extract_if(|_, w| lost(&w.target)) {
                if waiter.tx.send(Err(err.clone())).is_err() {
                    tracing::debug!(id, "caller stopped waiting");
                }
            }
            for (id, slot) in e.streams.extract_if(|_, s| lost(&s.target)) {
                if slot.tx.send(StreamEvent::End(Some(err.clone()))).is_err() {
                    tracing::debug!(id, "stream reader is gone");
                }
            }
        });
    }

    /// Ends every call and stream with `disconnected` (their senders are dropped), and refuses new
    /// ones.
    pub fn close(&self) {
        self.0.lock().expect("session poisoned").take();
    }
}

/// A later boot is a new gateway process: the old one's calls will never answer. An earlier boot
/// is only a late state from the old process.
pub fn restarted(sent_to: Option<u64>, seen: u64) -> bool {
    sent_to.is_some_and(|boot| seen > boot)
}

pub fn disconnected() -> RpcError {
    RpcError::new("disconnected", "lost the relay connection")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(mid: &str, direct: bool) -> Target {
        Target { mid: mid.into(), boot: Some(1), direct }
    }

    #[test]
    fn only_a_later_boot_means_a_restart() {
        assert!(restarted(Some(10), 11));
        assert!(!restarted(Some(10), 10), "same process");
        assert!(!restarted(Some(10), 9), "late state from the old process");
        assert!(!restarted(None, 11), "unknown when sent");
    }

    #[test]
    fn failing_ends_only_the_matching_calls_and_streams() {
        let inflight = Inflight::new();
        let (lost_tx, mut lost_rx) = oneshot::channel();
        let (kept_tx, mut kept_rx) = oneshot::channel();
        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel();
        inflight.add_call(1, target("a", true), lost_tx).unwrap();
        inflight.add_call(2, target("a", false), kept_tx).unwrap();
        inflight.add_stream(3, target("a", true), stream_tx).unwrap();

        inflight.fail(RpcError::new("disconnected", "gone"), |t| t.mid == "a" && t.direct);
        assert_eq!(lost_rx.try_recv().unwrap().unwrap_err().code, "disconnected");
        assert!(kept_rx.try_recv().is_err(), "the relayed call still waits");
        assert!(
            matches!(stream_rx.try_recv(), Ok(StreamEvent::End(Some(e))) if e.code == "disconnected")
        );

        inflight.resolve(2, Ok(Value::Null));
        assert_eq!(kept_rx.try_recv().unwrap().unwrap(), Value::Null);
    }

    #[test]
    fn closing_ends_everything_and_refuses_new_calls() {
        let inflight = Inflight::new();
        let (tx, mut rx) = oneshot::channel();
        inflight.add_call(1, target("a", false), tx).unwrap();
        inflight.close();
        assert!(matches!(rx.try_recv(), Err(oneshot::error::TryRecvError::Closed)));
        let (tx, _) = oneshot::channel();
        assert_eq!(inflight.add_call(2, target("a", false), tx).unwrap_err().code, "disconnected");
    }
}
