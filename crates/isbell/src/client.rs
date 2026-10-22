//! Client connection to the relay: the space snapshot, live state / presence, and calls to machines.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::{Frame, Header, RpcError};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineState;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::relay::{self, FrameStream, RelayError};

const RELAY_IDLE: Duration = Duration::from_secs(45);

#[derive(Debug, Clone)]
pub enum SessionEvent {
    State(Box<MachineState>),
    Presence { mid: String, online: bool },
    Closed,
}

/// A call awaiting its response.
struct Waiter {
    mid: String,
    /// The gateway process (its `boot`) the call was sent to, when known.
    boot: Option<u64>,
    tx: oneshot::Sender<Result<Value, RpcError>>,
}

type Pending = HashMap<u64, Waiter>;

#[derive(Default)]
struct Shared {
    states: HashMap<String, MachineState>,
    online: HashMap<String, bool>,
}

/// A client connection to the relay: the space snapshot, live updates, and calls to machines.
pub struct Session {
    shared: Arc<Mutex<Shared>>,
    pending: Arc<Mutex<Option<Pending>>>,
    out: mpsc::UnboundedSender<Frame>,
    events: broadcast::Sender<SessionEvent>,
    next_id: AtomicU64,
}

impl Session {
    pub async fn connect(url: &str, id: &Identity) -> Result<Session, RelayError> {
        let mut conn = relay::connect(url, id, None).await?;
        let Header::Snapshot { machines } = conn.stream.next(RELAY_IDLE).await?.header else {
            return Err(RelayError::Protocol("expected snapshot".into()));
        };
        let mut shared = Shared::default();
        for entry in machines {
            match serde_json::from_value::<MachineState>(entry.state) {
                Ok(state) => {
                    shared.online.insert(state.machine.id.clone(), entry.online);
                    shared.states.insert(state.machine.id.clone(), state);
                }
                Err(err) => tracing::warn!(%err, "ignoring unreadable machine state"),
            }
        }
        let shared = Arc::new(Mutex::new(shared));
        let pending = Arc::new(Mutex::new(Some(Pending::new())));
        let (events, _) = broadcast::channel(256);
        let (out, mut out_rx) = mpsc::unbounded_channel::<Frame>();
        let mut sink = conn.sink;
        tokio::spawn(async move {
            while let Some(frame) = out_rx.recv().await {
                if let Err(err) = sink.send(&frame).await {
                    tracing::debug!(%err, "relay write failed");
                    break;
                }
            }
        });
        tokio::spawn(read_loop(
            conn.stream,
            Arc::clone(&shared),
            Arc::clone(&pending),
            events.clone(),
        ));
        Ok(Session {
            shared,
            pending,
            out,
            events,
            next_id: AtomicU64::new(1),
        })
    }

    /// Every known machine with its online flag, ordered by name.
    pub fn machines(&self) -> Vec<(MachineState, bool)> {
        let shared = self.shared.lock().expect("session poisoned");
        let mut machines: Vec<_> = shared
            .states
            .values()
            .map(|s| {
                (
                    s.clone(),
                    shared.online.get(&s.machine.id).copied().unwrap_or(false),
                )
            })
            .collect();
        machines.sort_by(|a, b| {
            (&a.0.machine.name, &a.0.machine.id).cmp(&(&b.0.machine.name, &b.0.machine.id))
        });
        machines
    }

    pub fn events(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    /// Calls `m` on machine `mid`; `None` waits as long as the machine takes.
    pub async fn call(
        &self,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        let boot = self
            .shared
            .lock()
            .expect("session poisoned")
            .states
            .get(mid)
            .map(|s| s.boot);
        let waiter = Waiter {
            mid: mid.to_owned(),
            boot,
            tx,
        };
        match self.pending.lock().expect("session poisoned").as_mut() {
            Some(pending) => pending.insert(id, waiter),
            None => return Err(disconnected()),
        };
        let call = Header::Call {
            id,
            m: m.into(),
            p,
            mid: Some(mid.into()),
            from: None,
        };
        if self.out.send(Frame::new(call)).is_err() {
            return Err(disconnected());
        }
        let reply = match timeout {
            Some(limit) => tokio::time::timeout(limit, rx).await.map_err(|_| {
                self.forget(id);
                RpcError::new(
                    "timeout",
                    format!("no response within {}s", limit.as_secs()),
                )
            })?,
            None => rx.await,
        };
        reply.unwrap_or_else(|_| Err(disconnected()))
    }

    fn forget(&self, id: u64) {
        if let Some(pending) = self.pending.lock().expect("session poisoned").as_mut() {
            pending.remove(&id);
        }
    }
}

fn disconnected() -> RpcError {
    RpcError::new("disconnected", "lost the relay connection")
}

async fn read_loop(
    mut stream: FrameStream,
    shared: Arc<Mutex<Shared>>,
    pending: Arc<Mutex<Option<Pending>>>,
    events: broadcast::Sender<SessionEvent>,
) {
    let err = loop {
        let frame = match stream.next(RELAY_IDLE).await {
            Ok(frame) => frame,
            Err(err) => break err,
        };
        let event = match frame.header {
            Header::Res { id, ok, r, e, .. } => {
                let reply = if ok {
                    Ok(r.unwrap_or(Value::Null))
                } else {
                    Err(e.unwrap_or_else(|| RpcError::new("error", "")))
                };
                // A missing entry is a duplicate or late response; nobody is waiting for it.
                let waiter = pending
                    .lock()
                    .expect("session poisoned")
                    .as_mut()
                    .and_then(|p| p.remove(&id));
                if let Some(waiter) = waiter
                    && waiter.tx.send(reply).is_err()
                {
                    tracing::debug!(id, "caller stopped waiting");
                }
                None
            }
            Header::State { state } => match serde_json::from_value::<MachineState>(state) {
                Ok(state) => {
                    // A new boot is a new gateway process: the old one's calls will never answer.
                    fail_calls(&pending, "machine restarted before answering", |w| {
                        w.mid == state.machine.id && w.boot.is_some_and(|b| b != state.boot)
                    });
                    let mut shared = shared.lock().expect("session poisoned");
                    let newer = shared
                        .states
                        .get(&state.machine.id)
                        .is_none_or(|old| state.is_newer_than(old));
                    newer.then(|| {
                        shared
                            .states
                            .insert(state.machine.id.clone(), state.clone());
                        SessionEvent::State(Box::new(state))
                    })
                }
                Err(err) => {
                    tracing::warn!(%err, "ignoring unreadable machine state");
                    None
                }
            },
            Header::Presence { mid, online } => {
                if !online {
                    // The gateway is gone, and with it every call it was serving.
                    fail_calls(&pending, "machine went offline before answering", |w| {
                        w.mid == mid
                    });
                }
                shared
                    .lock()
                    .expect("session poisoned")
                    .online
                    .insert(mid.clone(), online);
                Some(SessionEvent::Presence { mid, online })
            }
            _ => None,
        };
        if let Some(event) = event
            && events.send(event).is_err()
        {
            tracing::trace!("no event listeners");
        }
    };
    tracing::debug!(%err, "relay session ended");
    // Dropping the waiters makes every pending call fail with `disconnected`.
    pending.lock().expect("session poisoned").take();
    if events.send(SessionEvent::Closed).is_err() {
        tracing::trace!("no event listeners");
    }
}

/// Fails the pending calls matching `lost` with `machine_offline`. A gateway that reconnects
/// keeps serving its calls; only one that went offline or restarted loses them.
fn fail_calls(pending: &Mutex<Option<Pending>>, reason: &str, lost: impl Fn(&Waiter) -> bool) {
    let mut guard = pending.lock().expect("session poisoned");
    let Some(pending) = guard.as_mut() else {
        return;
    };
    let ids: Vec<u64> = pending
        .iter()
        .filter(|(_, w)| lost(w))
        .map(|(id, _)| *id)
        .collect();
    for id in ids {
        let waiter = pending.remove(&id).expect("listed above");
        if waiter
            .tx
            .send(Err(RpcError::new("machine_offline", reason)))
            .is_err()
        {
            tracing::debug!(id, "caller stopped waiting");
        }
    }
}
