//! Isbell: a gateway that exposes this machine's herdr server through a relay, and the CLI that
//! reaches gateways from anywhere.

pub mod cli;
pub mod client;
mod config;
pub mod gateway;
pub mod relay;
mod rtc;

use std::time::{SystemTime, UNIX_EPOCH};

use tokio::task::JoinHandle;

/// Wall-clock milliseconds, the unit of every timestamp on the wire.
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("clock after epoch").as_millis() as u64
}

/// Ties a spawned task to its owner: dropping (or cancelling) the owner stops the task.
struct AbortOnDrop<T>(JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}
