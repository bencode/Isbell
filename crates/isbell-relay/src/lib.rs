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
}

impl RelayHandle {
    /// Resolves when the relay can no longer route (its Redis pub/sub connection is lost).
    pub async fn failed(&self) {
        self.bus.lost().await;
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
    let ctx = Arc::new(Ctx {
        config,
        bus: bus.clone(),
        ip_gate,
    });
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/ws", get(upgrade))
        .with_state(ctx)
        .into_make_service_with_connect_info::<SocketAddr>();
    let task = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            tracing::error!(%err, "relay server stopped");
        }
    });
    Ok(RelayHandle { addr, bus, task })
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
    ws.max_message_size(MAX_MESSAGE)
        .on_upgrade(move |socket| async move {
            conn::handle_socket(socket, ctx).await;
            drop(permit);
        })
}

fn client_ip(trust_proxy: bool, headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    let forwarded = || {
        headers
            .get("x-forwarded-for")?
            .to_str()
            .ok()?
            .split(',')
            .next()?
            .trim()
            .parse()
            .ok()
    };
    trust_proxy.then(forwarded).flatten().unwrap_or(peer.ip())
}
