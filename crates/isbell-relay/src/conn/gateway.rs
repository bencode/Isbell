//! A gateway's session: its frames go to clients of its space, paced by bytes.

use std::time::Instant;

use anyhow::Result;
use axum::extract::ws::WebSocket;
use isbell_proto::frame::Frame;
use tokio::sync::mpsc;

use super::route::{self, GatewayRoute};
use super::wire::{self, Incoming};
use super::{
    Authed, CLOSE_BAD_FRAME, CLOSE_REPLACED, Exit, KICK, PING_EVERY, REFRESH_EVERY, heartbeat,
    setup,
};
use crate::Ctx;
use crate::bus::{clients_channel, conn_channel};
use crate::limits::TokenBucket;

pub async fn serve(socket: &mut WebSocket, ctx: &Ctx, authed: &Authed, mid: &str) -> Result<Exit> {
    let (inbox, mut rx) = mpsc::unbounded_channel();
    let _subs = setup::gateway(socket, ctx, authed, mid, &inbox).await?;
    let limits = ctx.config.limits;
    // Gateways are limited per byte by slowing our reads: backpressure, never dropping.
    let mut bucket =
        TokenBucket::new(limits.gateway_bytes_per_sec, limits.gateway_burst_bytes, Instant::now());
    let (mut ping, mut refresh) =
        (tokio::time::interval(PING_EVERY), tokio::time::interval(REFRESH_EVERY));
    let mut last_seen = Instant::now();
    loop {
        tokio::select! {
            incoming = wire::recv(socket) => {
                last_seen = Instant::now();
                let (data, binary) = match incoming {
                    Incoming::Data(data, binary) => (data, binary),
                    Incoming::Control => continue,
                    Incoming::Gone => return Ok(Exit::Closed),
                };
                let (next, wait) = bucket.reserve(data.len() as f64, Instant::now());
                bucket = next;
                tokio::time::sleep(wait).await;
                if let Some(exit) = on_frame(ctx, authed, mid, &data, binary).await? {
                    return Ok(exit);
                }
            }
            Some(payload) = rx.recv() => {
                if payload == KICK {
                    return Ok(Exit::Close(CLOSE_REPLACED, "replaced by another gateway"));
                }
                wire::forward(socket, payload).await?;
            }
            _ = ping.tick() => if let Some(exit) = heartbeat(socket, last_seen).await? { return Ok(exit) },
            _ = refresh.tick() => {
                if !ctx.bus.refresh_gateway(&authed.sid, mid, &authed.conn).await? {
                    return Ok(Exit::Close(CLOSE_REPLACED, "replaced by another gateway"));
                }
            }
        }
    }
}

async fn on_frame(
    ctx: &Ctx,
    authed: &Authed,
    mid: &str,
    data: &[u8],
    binary: bool,
) -> Result<Option<Exit>> {
    let Ok(frame) = Frame::decode(data, binary) else {
        return Ok(Some(Exit::Close(CLOSE_BAD_FRAME, "bad frame")));
    };
    let sid = authed.sid.as_str();
    match route::route_gateway(sid, mid, frame) {
        GatewayRoute::State { json, frame } => {
            ctx.bus.put_state(sid, mid, &json).await?;
            ctx.bus.publish(&clients_channel(sid), frame.encode_binary()).await?;
        }
        GatewayRoute::ToClient { conn, frame } => {
            ctx.bus.publish(&conn_channel(&conn), frame.encode_binary()).await?;
        }
        GatewayRoute::Outside => tracing::warn!("dropped a frame addressed outside the space"),
        GatewayRoute::Reject => return Ok(Some(Exit::Close(CLOSE_BAD_FRAME, "frame not allowed"))),
    }
    Ok(None)
}
