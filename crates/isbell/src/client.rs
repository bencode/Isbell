//! Client connection to the relay: the space snapshot, live state / presence, and calls and
//! streams to machines.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
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

#[derive(Debug)]
pub enum StreamEvent {
    Frame {
        body: Vec<u8>,
        full: bool,
    },
    /// The stream ended; `Some` when it ended because of an error.
    End(Option<RpcError>),
}

/// Where a call or stream went: the machine, and its gateway process (`boot`) when known.
struct Target {
    mid: String,
    boot: Option<u64>,
}

struct Waiter {
    target: Target,
    tx: oneshot::Sender<Result<Value, RpcError>>,
}

struct StreamSlot {
    target: Target,
    tx: mpsc::UnboundedSender<StreamEvent>,
}

/// Calls awaiting a response and open streams, by id; `None` once the relay connection is gone.
#[derive(Default)]
struct Inflight {
    calls: HashMap<u64, Waiter>,
    streams: HashMap<u64, StreamSlot>,
}

type SharedInflight = Arc<Mutex<Option<Inflight>>>;

#[derive(Default)]
struct Shared {
    states: HashMap<String, MachineState>,
    online: HashMap<String, bool>,
}

/// A client connection to the relay: the space snapshot, live updates, and calls to machines.
pub struct Session {
    shared: Arc<Mutex<Shared>>,
    inflight: SharedInflight,
    out: mpsc::UnboundedSender<Frame>,
    events: broadcast::Sender<SessionEvent>,
    next_id: AtomicU64,
}

/// A stream opened with [`Session::open_stream`]; dropping it ends the stream.
pub struct Stream {
    id: u64,
    mid: String,
    out: mpsc::UnboundedSender<Frame>,
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    inflight: SharedInflight,
    ended: bool,
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
        let inflight: SharedInflight = Arc::new(Mutex::new(Some(Inflight::default())));
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
            Arc::clone(&inflight),
            events.clone(),
        ));
        Ok(Session {
            shared,
            inflight,
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
        self.request(id, mid, m, p, timeout).await
    }

    /// Opens a stream: a call whose response is followed by `data` until either side ends it.
    pub async fn open_stream(
        &self,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Duration,
    ) -> Result<(Value, Stream), RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::unbounded_channel();
        let slot = StreamSlot {
            target: self.target(mid),
            tx,
        };
        // Registered before the call so no data after the response is missed.
        self.inflight
            .lock()
            .expect("session poisoned")
            .as_mut()
            .ok_or_else(disconnected)?
            .streams
            .insert(id, slot);
        let stream = Stream {
            id,
            mid: mid.to_owned(),
            out: self.out.clone(),
            rx,
            inflight: Arc::clone(&self.inflight),
            ended: false,
        };
        let r = self.request(id, mid, m, p, Some(timeout)).await?;
        Ok((r, stream))
    }

    fn target(&self, mid: &str) -> Target {
        let boot = self
            .shared
            .lock()
            .expect("session poisoned")
            .states
            .get(mid)
            .map(|s| s.boot);
        Target {
            mid: mid.to_owned(),
            boot,
        }
    }

    async fn request(
        &self,
        id: u64,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, RpcError> {
        let (tx, rx) = oneshot::channel();
        let waiter = Waiter {
            target: self.target(mid),
            tx,
        };
        self.inflight
            .lock()
            .expect("session poisoned")
            .as_mut()
            .ok_or_else(disconnected)?
            .calls
            .insert(id, waiter);
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
                if let Some(inflight) = self.inflight.lock().expect("session poisoned").as_mut() {
                    inflight.calls.remove(&id);
                }
                RpcError::new(
                    "timeout",
                    format!("no response within {}s", limit.as_secs()),
                )
            })?,
            None => rx.await,
        };
        reply.unwrap_or_else(|_| Err(disconnected()))
    }
}

impl Stream {
    pub async fn next(&mut self) -> StreamEvent {
        let event = self
            .rx
            .recv()
            .await
            .unwrap_or_else(|| StreamEvent::End(Some(disconnected())));
        self.ended |= matches!(event, StreamEvent::End(_));
        event
    }

    pub fn input(&self, bytes: Vec<u8>) {
        self.send(DataKind::Input, Some(bytes), None);
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        self.send(DataKind::Resize, None, Some((cols, rows)));
    }

    pub fn ping(&self) {
        self.send(DataKind::Ping, None, None);
    }

    fn send(&self, k: DataKind, body: Option<Vec<u8>>, size: Option<(u16, u16)>) {
        let header = Header::Data {
            id: self.id,
            k,
            z: None,
            full: None,
            cols: size.map(|s| s.0),
            rows: size.map(|s| s.1),
            mid: Some(self.mid.clone()),
            from: None,
            to: None,
        };
        if self.out.send(Frame { header, body }).is_err() {
            tracing::debug!(id = self.id, "relay connection closed");
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        if let Some(inflight) = self.inflight.lock().expect("session poisoned").as_mut() {
            inflight.streams.remove(&self.id);
        }
        if !self.ended {
            let end = Header::End {
                id: self.id,
                e: None,
                mid: Some(self.mid.clone()),
                from: None,
                to: None,
            };
            if self.out.send(Frame::new(end)).is_err() {
                tracing::debug!(id = self.id, "relay connection closed");
            }
        }
    }
}

fn disconnected() -> RpcError {
    RpcError::new("disconnected", "lost the relay connection")
}

async fn read_loop(
    mut stream: FrameStream,
    shared: Arc<Mutex<Shared>>,
    inflight: SharedInflight,
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
                let waiter = inflight
                    .lock()
                    .expect("session poisoned")
                    .as_mut()
                    .and_then(|i| i.calls.remove(&id));
                if let Some(waiter) = waiter
                    && waiter.tx.send(reply).is_err()
                {
                    tracing::debug!(id, "caller stopped waiting");
                }
                None
            }
            Header::Data {
                id,
                k: DataKind::Frame,
                full,
                ..
            } => {
                let body = frame.body.unwrap_or_default();
                deliver(
                    &inflight,
                    id,
                    StreamEvent::Frame {
                        body,
                        full: full.unwrap_or(false),
                    },
                    false,
                );
                None
            }
            Header::End { id, e, .. } => {
                deliver(&inflight, id, StreamEvent::End(e), true);
                None
            }
            Header::State { state } => match serde_json::from_value::<MachineState>(state) {
                Ok(state) => {
                    // A new boot is a new gateway process: the old one's calls will never answer.
                    fail(&inflight, "machine restarted before answering", |t| {
                        t.mid == state.machine.id && t.boot.is_some_and(|b| b != state.boot)
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
                    // The gateway is gone, and with it every call and stream it was serving.
                    fail(&inflight, "machine went offline before answering", |t| {
                        t.mid == mid
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
    // Dropping the waiters and stream senders ends every call and stream with `disconnected`.
    inflight.lock().expect("session poisoned").take();
    if events.send(SessionEvent::Closed).is_err() {
        tracing::trace!("no event listeners");
    }
}

/// Hands an event to an open stream; `last` also closes it.
fn deliver(inflight: &Mutex<Option<Inflight>>, id: u64, event: StreamEvent, last: bool) {
    let mut guard = inflight.lock().expect("session poisoned");
    let Some(streams) = guard.as_mut().map(|i| &mut i.streams) else {
        return;
    };
    let tx = if last {
        streams.remove(&id).map(|s| s.tx)
    } else {
        streams.get(&id).map(|s| s.tx.clone())
    };
    if let Some(tx) = tx
        && tx.send(event).is_err()
    {
        tracing::debug!(id, "stream reader is gone");
    }
}

/// Fails the calls and ends the streams matching `lost` with `machine_offline`. A gateway that
/// reconnects keeps serving them; only one that went offline or restarted loses them.
fn fail(inflight: &Mutex<Option<Inflight>>, reason: &str, lost: impl Fn(&Target) -> bool) {
    let mut guard = inflight.lock().expect("session poisoned");
    let Some(inflight) = guard.as_mut() else {
        return;
    };
    let err = || RpcError::new("machine_offline", reason);
    let calls: Vec<u64> = inflight
        .calls
        .iter()
        .filter(|(_, w)| lost(&w.target))
        .map(|(id, _)| *id)
        .collect();
    for id in calls {
        let waiter = inflight.calls.remove(&id).expect("listed above");
        if waiter.tx.send(Err(err())).is_err() {
            tracing::debug!(id, "caller stopped waiting");
        }
    }
    let streams: Vec<u64> = inflight
        .streams
        .iter()
        .filter(|(_, s)| lost(&s.target))
        .map(|(id, _)| *id)
        .collect();
    for id in streams {
        let slot = inflight.streams.remove(&id).expect("listed above");
        if slot.tx.send(StreamEvent::End(Some(err()))).is_err() {
            tracing::debug!(id, "stream reader is gone");
        }
    }
}
