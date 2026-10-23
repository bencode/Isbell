//! Redis-backed routing and short-lived state. Every key expires within 15 minutes; nothing is persisted.
//!
//! ```text
//! isb:{sid}:m:{mid}:conn   string  connId of the gateway holding {mid}       TTL 30s, refreshed every 10s
//! isb:{sid}:m:{mid}:state  string  last MachineState JSON                    TTL 900s
//! isb:{sid}:machines       zset    mid → last seen (ms)                      TTL 900s
//! isb:{sid}:gw:{mid}       channel frames for a gateway
//! isb:{sid}:cl             channel state / presence for the space's clients
//! isb:c:{connId}           channel frames for one connection
//! ```

mod pubsub;
mod registry;

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use redis::aio::{ConnectionManager, PubSubSink};
use tokio::sync::watch;

pub use pubsub::{Inbox, InboxRx, Overflowed, Subscription, inbox};

#[derive(Clone)]
pub struct Bus {
    cmd: ConnectionManager,
    sink: PubSubSink,
    subscribers: Arc<Mutex<pubsub::Subscribers>>,
    /// Serializes Redis SUBSCRIBE / UNSUBSCRIBE so a late unsubscribe cannot undo a newer subscribe.
    sub_ops: Arc<tokio::sync::Mutex<()>>,
    next_id: Arc<AtomicU64>,
    scripts: Arc<registry::Scripts>,
    /// False once the pub/sub connection is gone; routing cannot recover without a restart.
    pubsub_alive: watch::Receiver<bool>,
}

impl Bus {
    pub async fn connect(redis_url: &str) -> Result<Bus> {
        let client = redis::Client::open(redis_url)?;
        let cmd = client.get_connection_manager().await?;
        let (sink, stream) = client.get_async_pubsub().await?.split();
        let (subscribers, pubsub_alive) = pubsub::fan_out(stream);
        Ok(Bus {
            cmd,
            sink,
            subscribers,
            sub_ops: Arc::default(),
            next_id: Arc::default(),
            scripts: Arc::new(registry::Scripts::new()),
            pubsub_alive,
        })
    }

    pub fn is_alive(&self) -> bool {
        *self.pubsub_alive.borrow()
    }

    /// Resolves once the pub/sub connection is lost.
    pub async fn lost(&self) {
        let mut alive = self.pubsub_alive.clone();
        if let Err(err) = alive.wait_for(|alive| !alive).await {
            // The sender lives in the fan-out task, which only exits after marking itself dead.
            tracing::error!(%err, "pub/sub liveness channel closed");
        }
    }

    pub async fn ping(&self) -> Result<()> {
        let _pong: String = redis::cmd("PING").query_async(&mut self.cmd.clone()).await?;
        Ok(())
    }
}

pub fn gateway_channel(sid: &str, mid: &str) -> String {
    format!("isb:{sid}:gw:{mid}")
}

pub fn clients_channel(sid: &str) -> String {
    format!("isb:{sid}:cl")
}

pub fn conn_channel(conn: &str) -> String {
    format!("isb:c:{conn}")
}

fn conn_key(sid: &str, mid: &str) -> String {
    format!("isb:{sid}:m:{mid}:conn")
}

fn state_key(sid: &str, mid: &str) -> String {
    format!("isb:{sid}:m:{mid}:state")
}

fn machines_key(sid: &str) -> String {
    format!("isb:{sid}:machines")
}
