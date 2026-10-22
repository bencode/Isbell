//! One Redis pub/sub connection per process, fanned out to local subscribers by channel.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use futures_util::StreamExt;
use redis::AsyncCommands;
use redis::aio::PubSubStream;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

use super::Bus;

pub(super) type Subscribers = HashMap<String, Vec<(u64, UnboundedSender<Vec<u8>>)>>;

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
            for (id, tx) in subs.get(msg.get_channel_name()).into_iter().flatten() {
                if tx.send(msg.get_payload_bytes().to_vec()).is_err() {
                    // Its connection is shutting down; the subscription guard cleans up.
                    tracing::trace!(id, "subscriber already gone");
                }
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
