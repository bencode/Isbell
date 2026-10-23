//! One Redis pub/sub connection per process, fanned out to local subscribers by channel.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use futures_util::StreamExt;
use redis::AsyncCommands;
use redis::aio::PubSubStream;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{Notify, mpsc, watch};

use super::Bus;

pub(super) type Subscribers = HashMap<String, Vec<(u64, Inbox)>>;

/// Where pub/sub messages for one connection wait to be written to its socket. It is bounded: a
/// connection that lets it fill up reads too slowly to keep, so it is told to close rather than
/// have the relay buffer for it. Dropping messages instead would silently break its streams.
#[derive(Clone)]
pub struct Inbox {
    tx: mpsc::Sender<Vec<u8>>,
    overflow: Arc<Notify>,
}

pub struct InboxRx {
    rx: mpsc::Receiver<Vec<u8>>,
    overflow: Arc<Notify>,
}

/// The connection fell `capacity` messages behind.
#[derive(Debug)]
pub struct Overflowed;

pub fn inbox(capacity: usize) -> (Inbox, InboxRx) {
    let (tx, rx) = mpsc::channel(capacity);
    let overflow = Arc::new(Notify::new());
    (Inbox { tx, overflow: Arc::clone(&overflow) }, InboxRx { rx, overflow })
}

impl Inbox {
    /// Never waits: one slow connection must not hold up the others.
    pub fn deliver(&self, payload: Vec<u8>) {
        match self.tx.try_send(payload) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => self.overflow.notify_one(),
            // Its connection is shutting down; the subscription guard cleans up.
            Err(TrySendError::Closed(_)) => tracing::trace!("subscriber already gone"),
        }
    }
}

impl InboxRx {
    /// The next message, or `Overflowed` once a message did not fit. The sender lives as long as
    /// the connection's subscriptions, so the queue never ends while it is read.
    pub async fn next(&mut self) -> Result<Vec<u8>, Overflowed> {
        tokio::select! {
            biased;
            () = self.overflow.notified() => Err(Overflowed),
            Some(payload) = self.rx.recv() => Ok(payload),
        }
    }
}

/// Local subscription; dropping it stops delivery and unsubscribes from Redis when it was the last one.
pub struct Subscription {
    bus: Bus,
    channel: String,
    id: u64,
}

/// Delivers every pub/sub message to the local subscribers of its channel. The returned flag
/// turns false when the pub/sub connection is gone, which this process cannot recover from.
pub(super) fn fan_out(
    mut stream: PubSubStream,
) -> (Arc<Mutex<Subscribers>>, watch::Receiver<bool>) {
    let subscribers: Arc<Mutex<Subscribers>> = Arc::default();
    let fanout = Arc::clone(&subscribers);
    let (alive_tx, alive) = watch::channel(true);
    tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            let subs = fanout.lock().expect("subscribers poisoned");
            for (_, inbox) in subs.get(msg.get_channel_name()).into_iter().flatten() {
                inbox.deliver(msg.get_payload_bytes().to_vec());
            }
        }
        tracing::error!("redis pub/sub stream ended");
        alive_tx.send_replace(false);
    });
    (subscribers, alive)
}

impl Bus {
    /// Returns how many relay processes received the message.
    pub async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<usize> {
        Ok(self.cmd.clone().publish(channel, payload).await?)
    }

    pub async fn subscribe(&self, channel: &str, inbox: Inbox) -> Result<Subscription> {
        let _ops = self.sub_ops.lock().await;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let first = {
            let mut subs = self.subscribers.lock().expect("subscribers poisoned");
            let list = subs.entry(channel.to_owned()).or_default();
            list.push((id, inbox));
            list.len() == 1
        };
        let subscription = Subscription { bus: self.clone(), channel: channel.to_owned(), id };
        if first {
            self.sink.clone().subscribe(channel).await?;
        }
        Ok(subscription)
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let emptied = {
            let mut subs = self.bus.subscribers.lock().expect("subscribers poisoned");
            subs.get_mut(&self.channel).is_some_and(|list| {
                list.retain(|(id, _)| *id != self.id);
                list.is_empty()
            })
        };
        if !emptied {
            return;
        }
        let bus = self.bus.clone();
        let channel = std::mem::take(&mut self.channel);
        tokio::spawn(async move {
            // Under the same lock as subscribe, so a late unsubscribe cannot undo a newer subscribe.
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
