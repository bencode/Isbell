//! A client's session: its frames go to machines of its space, within its message budget.

use std::time::Instant;

use anyhow::Result;
use axum::extract::ws::WebSocket;
use isbell_proto::frame::{Frame, Header, Route, RpcError};

use super::limit::{Admission, ClientLimiter};
use super::route::{self, ClientFrame};
use super::wire::{self, Incoming};
use super::{Authed, CLOSE_BAD_FRAME, Exit, PING_EVERY, heartbeat, setup, too_slow};
use crate::Ctx;
use crate::bus::{Overflowed, gateway_channel, inbox};

pub async fn serve(socket: &mut WebSocket, ctx: &Ctx, authed: &Authed) -> Result<Exit> {
    let (inbox, mut inbox_rx) = inbox(ctx.config.limits.inbox_frames);
    let _subs = setup::client(socket, ctx, authed, &inbox).await?;
    let mut limiter =
        ClientLimiter::new(ctx.config.limits.rate, ctx.config.limits.burst, Instant::now());
    let mut ping = tokio::time::interval(PING_EVERY);
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
                let Some(routed) = Frame::decode(&data, binary).ok().and_then(|f| route::route_client(&authed.conn, f)) else {
                    return Ok(Exit::Close(CLOSE_BAD_FRAME, "frame not allowed"));
                };
                let (next, admission) = limiter.admit(routed.id, routed.is_call, Instant::now());
                limiter = next;
                on_frame(socket, ctx, authed, routed, admission).await?;
            }
            payload = inbox_rx.next() => match payload {
                Ok(payload) => wire::forward(socket, payload).await?,
                Err(Overflowed) => return Ok(too_slow()),
            },
            _ = ping.tick() => if let Some(exit) = heartbeat(socket, last_seen).await? { return Ok(exit) },
        }
    }
}

async fn on_frame(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    routed: ClientFrame,
    admission: Admission,
) -> Result<()> {
    let ClientFrame { id, mid, is_call, frame } = routed;
    match admission {
        Admission::Forward => {
            let to_gateway = gateway_channel(&authed.sid, &mid);
            let delivered = ctx.bus.publish(&to_gateway, frame.encode_binary()).await?;
            if is_call && delivered == 0 {
                let offline = RpcError::new("machine_offline", "machine is offline");
                wire::send(socket, &error_res(id, mid, offline)).await?;
            }
        }
        Admission::RejectCall => wire::send(socket, &error_res(id, mid, rate_limited())).await?,
        Admission::EndStream => end_stream(socket, ctx, authed, id, mid).await?,
        Admission::Drop => {}
        Admission::DropUnnoticed => {
            tracing::warn!(id, "too many rate-limited streams; dropping without notice")
        }
    }
    Ok(())
}

/// Ends a rate-limited stream on both sides, so the gateway frees its session at once.
async fn end_stream(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    id: u64,
    mid: String,
) -> Result<()> {
    let end = |e, route| {
        Frame::new(Header::End { id, e, mid: None, from: None, to: None }).rerouted(route)
    };
    let to_gateway = end(None, Route { from: Some(authed.conn.clone()), ..Route::default() });
    ctx.bus.publish(&gateway_channel(&authed.sid, &mid), to_gateway.encode_binary()).await?;
    wire::send(socket, &end(Some(rate_limited()), Route { mid: Some(mid), ..Route::default() }))
        .await
}

fn rate_limited() -> RpcError {
    RpcError::new("rate_limited", "too many messages")
}

fn error_res(id: u64, mid: String, err: RpcError) -> Frame {
    Frame::new(Header::Res { id, ok: false, r: None, e: Some(err), mid: Some(mid), to: None })
}
