//! Isbell: a gateway that exposes this machine's herdr server through a relay, and the CLI that
//! reaches gateways from anywhere.

pub mod cli;
pub mod client;
pub mod config;
pub mod gateway;
pub mod relay;

use std::time::{SystemTime, UNIX_EPOCH};

/// Wall-clock milliseconds, the unit of every timestamp on the wire.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_millis() as u64
}
