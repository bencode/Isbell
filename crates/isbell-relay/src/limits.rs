//! In-process abuse limits. With several pods the effective per-IP limit is `limit × pods`.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(60);

pub struct IpGate {
    concurrent: usize,
    per_minute: u32,
    ips: Mutex<HashMap<IpAddr, IpState>>,
}

struct IpState {
    active: usize,
    window_start: Instant,
    opened: u32,
}

/// Holds one concurrent-connection slot until dropped.
pub struct IpPermit {
    gate: Arc<IpGate>,
    ip: IpAddr,
}

impl IpGate {
    pub fn new(concurrent: usize, per_minute: u32) -> Arc<Self> {
        Arc::new(Self {
            concurrent,
            per_minute,
            ips: Mutex::default(),
        })
    }

    pub fn try_acquire(self: &Arc<Self>, ip: IpAddr) -> Option<IpPermit> {
        let now = Instant::now();
        let mut ips = self.ips.lock().expect("ip gate poisoned");
        ips.retain(|_, s| s.active > 0 || now - s.window_start < WINDOW);
        let state = ips.entry(ip).or_insert(IpState {
            active: 0,
            window_start: now,
            opened: 0,
        });
        if now - state.window_start >= WINDOW {
            state.window_start = now;
            state.opened = 0;
        }
        if state.active >= self.concurrent || state.opened >= self.per_minute {
            return None;
        }
        state.active += 1;
        state.opened += 1;
        Some(IpPermit {
            gate: Arc::clone(self),
            ip,
        })
    }
}

impl Drop for IpPermit {
    fn drop(&mut self) {
        if let Some(state) = self
            .gate
            .ips
            .lock()
            .expect("ip gate poisoned")
            .get_mut(&self.ip)
        {
            state.active -= 1;
        }
    }
}

pub struct TokenBucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(rate: f64, burst: f64) -> Self {
        Self {
            rate,
            burst,
            tokens: burst,
            last: Instant::now(),
        }
    }

    pub fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + (now - self.last).as_secs_f64() * self.rate).min(self.burst);
        self.last = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_gate_enforces_concurrency_and_rate() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let gate = IpGate::new(2, 3);
        let a = gate.try_acquire(ip).unwrap();
        let _b = gate.try_acquire(ip).unwrap();
        assert!(gate.try_acquire(ip).is_none(), "concurrency limit");
        drop(a);
        let _c = gate.try_acquire(ip).unwrap();
        drop(_c);
        assert!(gate.try_acquire(ip).is_none(), "per-minute limit");
        assert!(
            gate.try_acquire("10.0.0.2".parse().unwrap()).is_some(),
            "other IPs unaffected"
        );
    }

    #[test]
    fn token_bucket_allows_burst_then_limits() {
        let mut bucket = TokenBucket::new(1.0, 3.0);
        assert!((0..3).all(|_| bucket.take()));
        assert!(!bucket.take());
    }
}
