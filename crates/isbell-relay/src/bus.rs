//! Redis-backed state and routing. Every key expires within 15 minutes; nothing is persisted.
//!
//! ```text
//! isb:{sid}:m:{mid}:conn   string  connId of the gateway holding {mid}       TTL 30s, refreshed every 10s
//! isb:{sid}:m:{mid}:state  string  last MachineState JSON                    TTL 900s
//! isb:{sid}:machines       zset    mid → last seen (ms)                      TTL 900s
//! isb:{sid}:gw:{mid}       channel frames for a gateway
//! isb:{sid}:cl             channel state / presence for the space's clients
//! isb:c:{connId}           channel frames for one connection
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use futures_util::StreamExt;
use redis::aio::{ConnectionManager, PubSubSink};
use redis::{AsyncCommands, Script};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

const CONN_TTL_SECS: u64 = 30;
const STATE_TTL_SECS: u64 = 900;

const REFRESH: &str = r"
local cur = redis.call('GET', KEYS[1])
if cur == false then
  -- The key vanished (Redis restart, flush or expiry): nobody else owns it, so re-claim.
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
elseif cur ~= ARGV[1] then
  return 0
else
  redis.call('EXPIRE', KEYS[1], ARGV[4])
end
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[5])
return 1";

const RELEASE: &str = r"
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 0";

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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_millis() as u64
}

type Subscribers = HashMap<String, Vec<(u64, UnboundedSender<Vec<u8>>)>>;

#[derive(Clone)]
pub struct Bus {
    cmd: ConnectionManager,
    sink: PubSubSink,
    subscribers: Arc<Mutex<Subscribers>>,
    /// Serializes Redis SUBSCRIBE / UNSUBSCRIBE so a late unsubscribe cannot undo a newer subscribe.
    sub_ops: Arc<tokio::sync::Mutex<()>>,
    next_id: Arc<AtomicU64>,
    refresh: Arc<Script>,
    release: Arc<Script>,
    /// False once the pub/sub connection is gone; routing cannot recover without a restart.
    pubsub_alive: watch::Receiver<bool>,
}

/// Local subscription; dropping it stops delivery and unsubscribes from Redis when it was the last one.
pub struct Subscription {
    bus: Bus,
    channel: String,
    id: u64,
}

impl Bus {
    pub async fn connect(redis_url: &str) -> Result<Bus> {
        let client = redis::Client::open(redis_url)?;
        let cmd = client.get_connection_manager().await?;
        let (sink, mut stream) = client.get_async_pubsub().await?.split();
        let subscribers: Arc<Mutex<Subscribers>> = Arc::default();
        let fanout = Arc::clone(&subscribers);
        let (alive_tx, pubsub_alive) = watch::channel(true);
        tokio::spawn(async move {
            while let Some(msg) = stream.next().await {
                let subs = fanout.lock().expect("subscribers poisoned");
                for (_, tx) in subs.get(msg.get_channel_name()).into_iter().flatten() {
                    // A closed receiver means its connection is shutting down; its guard cleans up.
                    let _ = tx.send(msg.get_payload_bytes().to_vec());
                }
            }
            tracing::error!("redis pub/sub stream ended");
            alive_tx.send_replace(false);
        });
        Ok(Bus {
            cmd,
            sink,
            subscribers,
            sub_ops: Arc::default(),
            next_id: Arc::default(),
            refresh: Arc::new(Script::new(REFRESH)),
            release: Arc::new(Script::new(RELEASE)),
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

    /// Takes ownership of `mid` for `conn`; returns the previous owner, if any.
    pub async fn claim_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<Option<String>> {
        let previous: Option<String> = redis::cmd("SET")
            .arg(conn_key(sid, mid))
            .arg(conn)
            .arg("EX")
            .arg(CONN_TTL_SECS)
            .arg("GET")
            .query_async(&mut self.cmd.clone())
            .await?;
        Ok(previous.filter(|p| p != conn))
    }

    /// Extends the gateway's TTLs, re-claiming the machine if its key vanished;
    /// false only when another connection holds the machine.
    pub async fn refresh_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<bool> {
        let owned: i64 = self
            .refresh
            .key(conn_key(sid, mid))
            .key(state_key(sid, mid))
            .key(machines_key(sid))
            .arg(conn)
            .arg(mid)
            .arg(now_ms())
            .arg(CONN_TTL_SECS)
            .arg(STATE_TTL_SECS)
            .invoke_async(&mut self.cmd.clone())
            .await?;
        Ok(owned == 1)
    }

    pub async fn release_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<()> {
        let _: i64 = self
            .release
            .key(conn_key(sid, mid))
            .arg(conn)
            .invoke_async(&mut self.cmd.clone())
            .await?;
        Ok(())
    }

    pub async fn put_state(&self, sid: &str, mid: &str, json: &str) -> Result<()> {
        let machines = machines_key(sid);
        redis::pipe()
            .set_ex(state_key(sid, mid), json, STATE_TTL_SECS)
            .zadd(&machines, mid, now_ms())
            .expire(&machines, STATE_TTL_SECS as i64)
            .exec_async(&mut self.cmd.clone())
            .await?;
        Ok(())
    }

    /// Last known state of every machine seen in the last 15 minutes, with its online flag.
    pub async fn snapshot(&self, sid: &str) -> Result<Vec<(String, bool)>> {
        let mut cmd = self.cmd.clone();
        let machines = machines_key(sid);
        let cutoff = now_ms().saturating_sub(STATE_TTL_SECS * 1000);
        let _: i64 = cmd.zrembyscore(&machines, "-inf", cutoff).await?;
        let mids: Vec<String> = cmd.zrange(&machines, 0, -1).await?;
        if mids.is_empty() {
            return Ok(Vec::new());
        }
        let mut pipe = redis::pipe();
        for mid in &mids {
            pipe.get(state_key(sid, mid)).exists(conn_key(sid, mid));
        }
        let rows: Vec<(Option<String>, bool)> = pipe.query_async(&mut cmd).await?;
        Ok(rows
            .into_iter()
            .filter_map(|(state, online)| Some((state?, online)))
            .collect())
    }

    /// Returns how many relay processes received the message.
    pub async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<usize> {
        Ok(self.cmd.clone().publish(channel, payload).await?)
    }

    pub async fn subscribe(
        &self,
        channel: &str,
        tx: UnboundedSender<Vec<u8>>,
    ) -> Result<Subscription> {
        let _ops = self.sub_ops.lock().await;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let first = {
            let mut subs = self.subscribers.lock().expect("subscribers poisoned");
            let list = subs.entry(channel.to_owned()).or_default();
            list.push((id, tx));
            list.len() == 1
        };
        let subscription = Subscription {
            bus: self.clone(),
            channel: channel.to_owned(),
            id,
        };
        if first {
            self.sink.clone().subscribe(channel).await?;
        }
        Ok(subscription)
    }

    pub async fn ping(&self) -> Result<()> {
        let _: String = redis::cmd("PING")
            .query_async(&mut self.cmd.clone())
            .await?;
        Ok(())
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let emptied = {
            let mut subs = self.bus.subscribers.lock().expect("subscribers poisoned");
            let list = subs.entry(self.channel.clone()).or_default();
            list.retain(|(id, _)| *id != self.id);
            list.is_empty()
        };
        if !emptied {
            return;
        }
        let bus = self.bus.clone();
        let channel = std::mem::take(&mut self.channel);
        tokio::spawn(async move {
            let _ops = bus.sub_ops.lock().await;
            let still_empty = {
                let mut subs = bus.subscribers.lock().expect("subscribers poisoned");
                let empty = subs.get(&channel).is_none_or(Vec::is_empty);
                if empty {
                    subs.remove(&channel);
                }
                empty
            };
            if still_empty && let Err(err) = bus.sink.clone().unsubscribe(&channel).await {
                tracing::warn!(%err, "redis unsubscribe failed");
            }
        });
    }
}
