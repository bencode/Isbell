//! Client connection to the relay: the space snapshot, live state / presence, and calls and
//! streams to machines. Streams use a machine's direct link once one is open (`Session::direct`);
//! calls always use the relay.

mod direct;
mod file;
mod inbound;
mod inflight;
mod link;
mod space;
mod stream;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::{Frame, Header, RpcError};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineState;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

pub use self::file::{FileRead, FileWrite};
use self::inbound::{read_loop, write_loop};
use self::inflight::{Inflight, Target, disconnected};
use self::link::Link;
use self::space::Space;
pub use self::stream::{Stream, StreamEvent};
use crate::relay::{self, RELAY_IDLE, RelayError};

#[derive(Debug, Clone)]
pub enum SessionEvent {
    State(Box<MachineState>),
    Presence { mid: String, online: bool },
    Closed,
}

/// Direct links by machine id: at most one per machine.
type PeerLinks = Mutex<HashMap<String, Link>>;

/// A client connection to the relay: the space snapshot, live updates, and calls to machines.
pub struct Session {
    space: Arc<Mutex<Space>>,
    inflight: Inflight,
    /// Frames for the relay connection, whatever machine they are for.
    to_relay: mpsc::UnboundedSender<Frame>,
    peers: Arc<PeerLinks>,
    /// One direct link is set up at a time, so a machine never gets two.
    opening: tokio::sync::Mutex<()>,
    events: broadcast::Sender<SessionEvent>,
    next_id: AtomicU64,
}

impl Session {
    pub async fn connect(url: &str, id: &Identity) -> Result<Session, RelayError> {
        let mut conn = relay::connect(url, id, None).await?;
        let Header::Snapshot { machines } = conn.stream.next(RELAY_IDLE).await?.header else {
            return Err(RelayError::Protocol("expected snapshot".into()));
        };
        let space = Arc::new(Mutex::new(Space::from_snapshot(machines)));
        let inflight = Inflight::new();
        let (events, _) = broadcast::channel(256);
        let (to_relay, relay_rx) = mpsc::unbounded_channel();
        tokio::spawn(write_loop(conn.sink, relay_rx));
        let read = read_loop(conn.stream, Arc::clone(&space), inflight.clone(), events.clone());
        tokio::spawn(read);
        Ok(Session {
            space,
            inflight,
            to_relay,
            peers: Arc::default(),
            opening: tokio::sync::Mutex::default(),
            events,
            next_id: AtomicU64::new(1),
        })
    }

    /// Every known machine with its online flag, ordered by name.
    pub fn machines(&self) -> Vec<(MachineState, bool)> {
        self.space.lock().expect("session poisoned").machines()
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
        self.request(self.next_id(), &self.relay_link(mid), mid, m, p, timeout).await
    }

    /// Opens a stream: a call whose response is followed by `data` until either side ends it.
    pub async fn open_stream(
        &self,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Duration,
    ) -> Result<(Value, Stream), RpcError> {
        let id = self.next_id();
        let (tx, rx) = mpsc::unbounded_channel();
        let link = self.stream_link(mid);
        // Registered before the call so no data after the response is missed.
        self.inflight.add_stream(id, self.target(mid, link.is_direct()), tx)?;
        let stream = Stream::new(id, link.clone(), rx, self.inflight.clone());
        let r = self.request(id, &link, mid, m, p, Some(timeout)).await?;
        Ok((r, stream))
    }

    /// The way streams reach machine `mid`: its direct link when one is open, else the relay.
    fn stream_link(&self, mid: &str) -> Link {
        let direct = self.peers.lock().expect("session poisoned").get(mid).cloned();
        direct.unwrap_or_else(|| self.relay_link(mid))
    }

    fn relay_link(&self, mid: &str) -> Link {
        Link::relay(self.to_relay.clone(), mid)
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn target(&self, mid: &str, direct: bool) -> Target {
        let boot = self.space.lock().expect("session poisoned").boot(mid);
        Target { mid: mid.to_owned(), boot, direct }
    }

    async fn request(
        &self,
        id: u64,
        link: &Link,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, RpcError> {
        let (tx, rx) = oneshot::channel();
        self.inflight.add_call(id, self.target(mid, link.is_direct()), tx)?;
        let call = Header::Call { id, m: m.into(), p, mid: None, from: None };
        if let Err(err) = link.send(Frame::new(call)) {
            self.inflight.forget_call(id);
            return Err(err);
        }
        let reply = match timeout {
            Some(limit) => tokio::time::timeout(limit, rx).await.map_err(|_| {
                self.inflight.forget_call(id);
                RpcError::new("timeout", format!("no response within {}s", limit.as_secs()))
            })?,
            None => rx.await,
        };
        reply.unwrap_or_else(|_| Err(disconnected()))
    }
}
