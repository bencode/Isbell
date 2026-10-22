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

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub ip_concurrent: usize,
    pub ip_per_minute: u32,
    pub rate: f64,
    pub burst: f64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            ip_concurrent: 20,
            ip_per_minute: 30,
            rate: 50.0,
            burst: 100.0,
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
        Ok(value) => Ok(Some(
            value.parse().with_context(|| format!("invalid {name}"))?,
        )),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(err) => Err(err).with_context(|| format!("invalid {name}")),
    }
}
