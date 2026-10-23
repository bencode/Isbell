//! One WebSocket connection, as a thin shell around pure routing and limiting:
//!
//! ```text
//! open --challenge--> challenged --valid auth, routes ready, auth_ok--> authed(gateway | client) --close--> closed
//! challenged --bad signature / non-auth frame / frame > 4KB--> closed(4003)
//! challenged --no auth within 10s--> closed(4004)
//! authed --undecodable frame / frame not allowed for the role--> closed(4400)
//! authed(gateway) --replaced by a newer gateway for the same machine--> closed(4001)
//! ```

mod auth;
mod client;
mod gateway;
mod limit;
mod route;
mod setup;
mod wire;

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use axum::extract::ws::WebSocket;
use isbell_proto::frame::{
    CLOSE_AUTH_FAILED, CLOSE_AUTH_TIMEOUT, CLOSE_BAD_FRAME, CLOSE_REPLACED, CLOSE_TOO_SLOW, Frame,
    Header,
};
use tracing::Instrument;

use self::auth::Peer;
use crate::Ctx;
use crate::bus::clients_channel;

const PING_EVERY: Duration = Duration::from_secs(15);
const PONG_TIMEOUT: Duration = Duration::from_secs(30);
/// A peer that takes no message for this long is as gone as one that sends no pong.
const WRITE_WITHIN: Duration = PONG_TIMEOUT;
const REFRESH_EVERY: Duration = Duration::from_secs(10);

const CLOSE_INTERNAL: u16 = 1011;

/// Payload published to a connection's channel to close it as replaced. Never a valid frame.
const KICK: &[u8] = &[0];

pub enum Exit {
    Closed,
    /// No sign of life for too long; logged as abnormal (1006), nothing is sent.
    TimedOut,
    Close(u16, &'static str),
}

struct Authed {
    sid: String,
    conn: String,
    peer: Peer,
}

pub async fn handle_socket(mut socket: WebSocket, ctx: Arc<Ctx>) {
    let admitted = match auth::authenticate(&mut socket, &ctx.config.public_origin).await {
        Ok(admitted) => admitted,
        Err(Exit::Close(code, reason)) => return wire::close(socket, code, reason).await,
        Err(Exit::Closed | Exit::TimedOut) => return,
    };
    let authed = Authed {
        conn: route::conn_id(&admitted.sid, uuid::Uuid::new_v4()),
        sid: admitted.sid,
        peer: admitted.peer,
    };
    let mid = match &authed.peer {
        Peer::Gateway(machine) => Some(machine.id.clone()),
        Peer::Client => None,
    };
    let role = authed.peer.role().as_str();
    let span = tracing::info_span!("conn", sid = &authed.sid[..6], role, mid);
    async move {
        tracing::info!(event = "auth");
        let code = match run(&mut socket, &ctx, &authed).await {
            Exit::Close(code, reason) => {
                wire::close(socket, code, reason).await;
                code
            }
            Exit::Closed => 1000,
            Exit::TimedOut => 1006,
        };
        tracing::info!(event = "close", code);
    }
    .instrument(span)
    .await;
}

/// Serves the connection, then always cleans up: a gateway that was not replaced releases its
/// machine, and announces it offline when nobody else owns it.
async fn run(socket: &mut WebSocket, ctx: &Ctx, authed: &Authed) -> Exit {
    let served = match &authed.peer {
        Peer::Gateway(machine) => gateway::serve(socket, ctx, authed, &machine.id).await,
        Peer::Client => client::serve(socket, ctx, authed).await,
    };
    let exit = served.unwrap_or_else(|err| {
        tracing::error!(%err, "connection failed");
        Exit::Close(CLOSE_INTERNAL, "internal error")
    });
    let replaced = matches!(exit, Exit::Close(CLOSE_REPLACED, _));
    if let (Peer::Gateway(machine), false) = (&authed.peer, replaced) {
        release(ctx, authed, &machine.id).await;
    }
    exit
}

async fn release(ctx: &Ctx, authed: &Authed, mid: &str) {
    let sid = authed.sid.as_str();
    match ctx.bus.release_gateway(sid, mid, &authed.conn).await {
        Ok(true) => {
            let offline = Frame::new(Header::Presence { mid: mid.to_owned(), online: false });
            if let Err(err) = ctx.bus.publish(&clients_channel(sid), offline.encode_binary()).await
            {
                tracing::error!(%err, "cannot announce the machine offline");
            }
        }
        Ok(false) => {
            tracing::info!("another connection owns the machine; not announcing it offline")
        }
        Err(err) => tracing::error!(%err, "cannot release the machine"),
    }
}

/// The connection fell too far behind its inbox (see `bus::Inbox`).
pub(super) fn too_slow() -> Exit {
    tracing::warn!("connection too slow to keep up; closing it");
    Exit::Close(CLOSE_TOO_SLOW, "too slow")
}

/// Pings the peer, or reports it dead when nothing has arrived for too long.
pub(super) async fn heartbeat(socket: &mut WebSocket, last_seen: Instant) -> Result<Option<Exit>> {
    if last_seen.elapsed() > PONG_TIMEOUT {
        return Ok(Some(Exit::TimedOut));
    }
    wire::ping(socket).await?;
    Ok(None)
}
