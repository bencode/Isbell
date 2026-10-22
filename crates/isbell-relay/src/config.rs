use std::net::SocketAddr;

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub redis_url: String,
    /// Signed into every auth challenge so signatures cannot be replayed against another relay.
    pub public_origin: String,
    /// Take the client IP from the first `x-forwarded-for` hop.
    pub trust_proxy: bool,
    pub limits: Limits,
}

const MIB: f64 = 1024.0 * 1024.0;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub ip_concurrent: usize,
    pub ip_per_minute: u32,
    /// Client messages per second (and burst); beyond it the relay answers `rate_limited`.
    pub rate: f64,
    pub burst: f64,
    /// Gateway bytes per second (and burst); beyond it the relay slows its reads, never drops.
    pub gateway_bytes_per_sec: f64,
    pub gateway_burst_bytes: f64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            ip_concurrent: 20,
            ip_per_minute: 30,
            rate: 50.0,
            burst: 100.0,
            gateway_bytes_per_sec: 8.0 * MIB,
            gateway_burst_bytes: 16.0 * MIB,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Config> {
        let defaults = Limits::default();
        Ok(Config {
            bind: var("BIND")?.unwrap_or(([0, 0, 0, 0], 8787).into()),
            redis_url: var("REDIS_URL")?.unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned()),
            public_origin: var("PUBLIC_ORIGIN")?
                .unwrap_or_else(|| "ws://localhost:8787".to_owned()),
            trust_proxy: var::<String>("TRUST_PROXY")?.is_some_and(|v| v == "1"),
            limits: Limits {
                ip_concurrent: var("LIMIT_IP_CONCURRENT")?.unwrap_or(defaults.ip_concurrent),
                ip_per_minute: var("LIMIT_IP_PER_MINUTE")?.unwrap_or(defaults.ip_per_minute),
                rate: var("LIMIT_RATE")?.unwrap_or(defaults.rate),
                burst: var("LIMIT_BURST")?.unwrap_or(defaults.burst),
                gateway_bytes_per_sec: var("LIMIT_GATEWAY_BYTES_PER_SEC")?
                    .unwrap_or(defaults.gateway_bytes_per_sec),
                gateway_burst_bytes: var("LIMIT_GATEWAY_BURST_BYTES")?
                    .unwrap_or(defaults.gateway_burst_bytes),
            },
        })
    }
}

fn var<T>(name: &str) -> Result<Option<T>>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match std::env::var(name) {
        Ok(value) => Ok(Some(value.parse().with_context(|| format!("invalid {name}"))?)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(err) => Err(err).with_context(|| format!("invalid {name}")),
    }
}
