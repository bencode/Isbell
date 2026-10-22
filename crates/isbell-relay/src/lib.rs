//! Isbell relay: authenticates gateways and clients of a space and routes frames between them.
//! It keeps only short-lived routing state in Redis and never stores message content.

pub mod bus;
pub mod config;
mod conn;
pub mod limits;

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::bus::Bus;
use crate::config::Config;
use crate::limits::IpGate;

pub use conn::{CLOSE_AUTH_FAILED, CLOSE_AUTH_TIMEOUT, CLOSE_BAD_FRAME, CLOSE_REPLACED};

const MAX_MESSAGE: usize = 1 << 20;

struct Ctx {
    config: Config,
    bus: Bus,
    ip_gate: Arc<IpGate>,
}

pub struct RelayHandle {
    pub addr: SocketAddr,
    bus: Bus,
    task: JoinHandle<()>,
    /// Flips to true when the HTTP server stops.
    stopped: watch::Receiver<bool>,
}

impl RelayHandle {
    /// Resolves when the relay can no longer serve: its Redis pub/sub connection is lost or its
    /// HTTP server stopped.
    pub async fn failed(&self) {
        let mut stopped = self.stopped.clone();
        tokio::select! {
            () = self.bus.lost() => {}
            result = stopped.wait_for(|stopped| *stopped) => {
                if let Err(err) = result {
                    tracing::error!(%err, "relay server state unknown");
                }
            }
        }
    }

    pub fn shutdown(self) {
        self.task.abort();
    }
}

pub async fn serve(config: Config) -> Result<RelayHandle> {
    let bus = Bus::connect(&config.redis_url).await?;
    let listener = TcpListener::bind(config.bind).await?;
    let addr = listener.local_addr()?;
    let ip_gate = IpGate::new(config.limits.ip_concurrent, config.limits.ip_per_minute);
    let ctx = Arc::new(Ctx { config, bus: bus.clone(), ip_gate });
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/ws", get(upgrade))
        .with_state(ctx)
        .into_make_service_with_connect_info::<SocketAddr>();
    let (stopped_tx, stopped) = watch::channel(false);
    let task = tokio::spawn(async move {
        match axum::serve(listener, app).await {
            Ok(()) => tracing::error!("relay server stopped"),
            Err(err) => tracing::error!(%err, "relay server stopped"),
        }
        stopped_tx.send_replace(true);
    });
    Ok(RelayHandle { addr, bus, task, stopped })
}

async fn healthz(State(ctx): State<Arc<Ctx>>) -> StatusCode {
    if !ctx.bus.is_alive() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    match ctx.bus.ping().await {
        Ok(()) => StatusCode::OK,
        Err(err) => {
            tracing::error!(%err, "redis ping failed");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

async fn upgrade(
    State(ctx): State<Arc<Ctx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let ip = client_ip(ctx.config.trust_proxy, &headers, peer);
    let Some(permit) = ctx.ip_gate.try_acquire(ip) else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    ws.max_message_size(MAX_MESSAGE).on_upgrade(move |socket| async move {
        conn::handle_socket(socket, ctx).await;
        drop(permit);
    })
}

/// The peer address, or behind a trusted proxy the hop that proxy appended to
/// `X-Forwarded-For` (the last one; earlier hops come from the client and can be forged).
fn client_ip(trust_proxy: bool, headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    let forwarded =
        || headers.get("x-forwarded-for")?.to_str().ok()?.rsplit(',').next()?.trim().parse().ok();
    trust_proxy.then(forwarded).flatten().unwrap_or(peer.ip())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(trust_proxy: bool, forwarded: Option<&str>) -> IpAddr {
        let headers: HeaderMap = forwarded
            .map(|v| {
                [("x-forwarded-for".parse().unwrap(), v.parse().unwrap())].into_iter().collect()
            })
            .unwrap_or_default();
        client_ip(trust_proxy, &headers, ([10, 0, 0, 9], 4000).into())
    }

    #[test]
    fn takes_the_hop_added_by_the_trusted_proxy() {
        assert_eq!(ip(true, Some("203.0.113.7")), "203.0.113.7".parse::<IpAddr>().unwrap());
        assert_eq!(
            ip(true, Some("1.2.3.4, 203.0.113.7")),
            "203.0.113.7".parse::<IpAddr>().unwrap()
        );
        assert_eq!(ip(true, Some("not-an-ip")), "10.0.0.9".parse::<IpAddr>().unwrap());
        assert_eq!(ip(false, Some("203.0.113.7")), "10.0.0.9".parse::<IpAddr>().unwrap());
        assert_eq!(ip(true, None), "10.0.0.9".parse::<IpAddr>().unwrap());
    }
}
