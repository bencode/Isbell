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

/// A token bucket as a value: every operation takes the current time and returns a new bucket.
#[derive(Debug, Clone, Copy)]
pub struct TokenBucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    at: Instant,
}

impl TokenBucket {
    pub fn new(rate: f64, burst: f64, now: Instant) -> Self {
        Self {
            rate,
            burst,
            tokens: burst,
            at: now,
        }
    }

    fn refilled(self, now: Instant) -> Self {
        let tokens = (self.tokens
            + now.saturating_duration_since(self.at).as_secs_f64() * self.rate)
            .min(self.burst);
        Self {
            tokens,
            at: now,
            ..self
        }
    }

    /// Spends `cost` even into debt; returns how long to wait until the balance is back to zero.
    pub fn reserve(self, cost: f64, now: Instant) -> (Self, Duration) {
        let bucket = self.refilled(now);
        let tokens = bucket.tokens - cost;
        let wait = if tokens >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-tokens / bucket.rate)
        };
        (Self { tokens, ..bucket }, wait)
    }

    /// Spends `cost` only if the balance covers it.
    pub fn try_take(self, cost: f64, now: Instant) -> (Self, bool) {
        let bucket = self.refilled(now);
        if bucket.tokens < cost {
            return (bucket, false);
        }
        (
            Self {
                tokens: bucket.tokens - cost,
                ..bucket
            },
            true,
        )
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
    fn try_take_allows_the_burst_then_refuses_without_spending() {
        let start = Instant::now();
        let (bucket, taken) =
            (0..3).fold((TokenBucket::new(1.0, 3.0, start), true), |(b, ok), _| {
                let (b, took) = b.try_take(1.0, start);
                (b, ok && took)
            });
        assert!(taken);
        let (bucket, took) = bucket.try_take(1.0, start);
        assert!(!took);
        let (_, took) = bucket.try_take(1.0, start + Duration::from_secs(1));
        assert!(took, "refilled after a second");
    }

    #[test]
    fn reserve_goes_into_debt_and_reports_the_wait() {
        let start = Instant::now();
        let (bucket, wait) = TokenBucket::new(100.0, 100.0, start).reserve(60.0, start);
        assert_eq!(wait, Duration::ZERO);
        let (bucket, wait) = bucket.reserve(90.0, start);
        assert_eq!(wait, Duration::from_millis(500), "50 tokens short at 100/s");
        let (_, wait) = bucket.reserve(0.0, start + Duration::from_millis(500));
        assert_eq!(wait, Duration::ZERO);
    }
}
