//! One WebSocket connection:
//!
//! ```text
//! open --challenge--> challenged --valid auth, routes ready, auth_ok--> authed(gateway | client) --close--> closed
//! challenged --bad signature / non-auth frame / frame > 4KB--> closed(4003)
//! challenged --no auth within 10s--> closed(4004)
//! authed --undecodable frame / frame not allowed for the role--> closed(4400)
//! authed(gateway) --replaced by a newer gateway for the same machine--> closed(4001)
//! ```

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use axum::extract::ws::{CloseFrame, Message, WebSocket};
use data_encoding::BASE64URL_NOPAD;
use isbell_proto::frame::{
    Encoded, Frame, Header, MachineInfo, RpcError, SnapshotEntry, is_machine_id,
};
use isbell_proto::identity::{Role, verify_auth};
use tokio::sync::mpsc;

use crate::Ctx;
use crate::bus::{Subscription, clients_channel, conn_channel, gateway_channel};
use crate::limits::TokenBucket;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_AUTH_FRAME: usize = 4096;
const PING_EVERY: Duration = Duration::from_secs(15);
const PONG_TIMEOUT: Duration = Duration::from_secs(30);
const REFRESH_EVERY: Duration = Duration::from_secs(10);
/// Stream ids that already got a `rate_limited` end during one throttling episode.
const MAX_THROTTLED: usize = 1024;

pub const CLOSE_REPLACED: u16 = 4001;
pub const CLOSE_AUTH_FAILED: u16 = 4003;
pub const CLOSE_AUTH_TIMEOUT: u16 = 4004;
pub const CLOSE_BAD_FRAME: u16 = 4400;

/// Payload published to a connection's channel to close it as replaced. Never a valid frame.
const KICK: &[u8] = &[0];

struct Authed {
    sid: String,
    conn: String,
    role: Role,
    machine: Option<MachineInfo>,
}

enum Exit {
    Closed,
    Close(u16, &'static str),
}

pub async fn handle_socket(mut socket: WebSocket, ctx: Arc<Ctx>) {
    let authed = match authenticate(&mut socket, &ctx).await {
        Ok(authed) => authed,
        Err(Exit::Close(code, reason)) => return close(socket, code, reason).await,
        Err(Exit::Closed) => return,
    };
    let mid = authed.machine.as_ref().map(|m| m.id.as_str());
    tracing::info!(
        event = "auth",
        sid = &authed.sid[..6],
        role = authed.role.as_str(),
        mid
    );
    let exit = match run(&mut socket, &ctx, &authed).await {
        Ok(exit) => exit,
        Err(err) => {
            tracing::error!(%err, sid = &authed.sid[..6], "connection failed");
            Exit::Close(1011, "internal error")
        }
    };
    let code = match exit {
        Exit::Close(code, reason) => {
            close(socket, code, reason).await;
            code
        }
        Exit::Closed => 1000,
    };
    tracing::info!(
        event = "close",
        sid = &authed.sid[..6],
        role = authed.role.as_str(),
        mid,
        code
    );
}

async fn close(mut socket: WebSocket, code: u16, reason: &'static str) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    if let Err(err) = socket.send(Message::Close(Some(frame))).await {
        tracing::debug!(%err, "close frame not delivered");
    }
}

async fn authenticate(socket: &mut WebSocket, ctx: &Ctx) -> Result<Authed, Exit> {
    let nonce = BASE64URL_NOPAD.encode(&rand::random::<[u8; 16]>());
    let challenge = Header::Challenge {
        nonce: nonce.clone(),
        origin: ctx.config.public_origin.clone(),
    };
    send(socket, &Frame::new(challenge))
        .await
        .map_err(|_| Exit::Closed)?;

    let (data, binary) = tokio::time::timeout(AUTH_TIMEOUT, next_data(socket))
        .await
        .map_err(|_| Exit::Close(CLOSE_AUTH_TIMEOUT, "auth timeout"))?
        .ok_or(Exit::Closed)?;
    let failed = Exit::Close(CLOSE_AUTH_FAILED, "auth failed");
    if data.len() > MAX_AUTH_FRAME {
        return Err(failed);
    }
    let Ok(Frame {
        header:
            Header::Auth {
                role,
                pk,
                sig,
                machine,
            },
        ..
    }) = Frame::decode(&data, binary)
    else {
        return Err(failed);
    };
    let sid = verify_auth(&pk, &sig, role, &ctx.config.public_origin, &nonce).ok_or(failed)?;
    let machine_ok = match role {
        Role::Gateway => machine.as_ref().is_some_and(MachineInfo::is_valid),
        Role::Client => machine.is_none(),
    };
    if !machine_ok {
        return Err(Exit::Close(CLOSE_AUTH_FAILED, "auth failed"));
    }
    let conn = format!("{sid}.{}", uuid::Uuid::new_v4().simple());
    Ok(Authed {
        sid,
        conn,
        role,
        machine,
    })
}

/// Next text or binary message; `None` once the peer is gone.
async fn next_data(socket: &mut WebSocket) -> Option<(Vec<u8>, bool)> {
    loop {
        match socket.recv().await? {
            Ok(Message::Text(text)) => return Some((text.as_bytes().to_vec(), false)),
            Ok(Message::Binary(bytes)) => return Some((bytes.to_vec(), true)),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(Message::Ping(_) | Message::Pong(_)) => {}
        }
    }
}

async fn send(socket: &mut WebSocket, frame: &Frame) -> Result<()> {
    let msg = match frame.encode() {
        Encoded::Text(text) => Message::Text(text.into()),
        Encoded::Binary(bytes) => Message::Binary(bytes.into()),
    };
    Ok(socket.send(msg).await?)
}

/// Forwards a pub/sub payload (always binary-framed) as text when it carries no body.
async fn forward(socket: &mut WebSocket, payload: Vec<u8>) -> Result<()> {
    let header_len = payload.get(..4).map_or(0, |b| {
        u32::from_be_bytes(b.try_into().expect("4 bytes")) as usize
    });
    let msg = if payload.len() == 4 + header_len {
        Message::Text(String::from_utf8(payload[4..].to_vec())?.into())
    } else {
        Message::Binary(payload.into())
    };
    Ok(socket.send(msg).await?)
}

/// Sent only once the connection is routable, so a gateway that sees `auth_ok` can already receive calls.
async fn send_auth_ok(socket: &mut WebSocket, authed: &Authed) -> Result<()> {
    send(
        socket,
        &Frame::new(Header::AuthOk {
            sid: authed.sid.clone(),
            conn: authed.conn.clone(),
        }),
    )
    .await
}

type Outbox = mpsc::UnboundedSender<Vec<u8>>;

/// Claims the machine (kicking a previous owner), subscribes, announces presence, then acks auth.
async fn setup_gateway(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    mid: &str,
    tx: &Outbox,
) -> Result<Vec<Subscription>> {
    let (bus, sid) = (&ctx.bus, authed.sid.as_str());
    if let Some(previous) = bus.claim_gateway(sid, mid, &authed.conn).await? {
        bus.publish(&conn_channel(&previous), KICK.to_vec()).await?;
    }
    let subs = vec![
        bus.subscribe(&gateway_channel(sid, mid), tx.clone())
            .await?,
        bus.subscribe(&conn_channel(&authed.conn), tx.clone())
            .await?,
    ];
    let online = Header::Presence {
        mid: mid.to_owned(),
        online: true,
    };
    bus.publish(&clients_channel(sid), Frame::new(online).encode_binary())
        .await?;
    send_auth_ok(socket, authed).await?;
    Ok(subs)
}

/// Subscribes before reading the snapshot so no state change between the two is missed.
async fn setup_client(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    tx: &Outbox,
) -> Result<Vec<Subscription>> {
    let (bus, sid) = (&ctx.bus, authed.sid.as_str());
    let subs = vec![
        bus.subscribe(&clients_channel(sid), tx.clone()).await?,
        bus.subscribe(&conn_channel(&authed.conn), tx.clone())
            .await?,
    ];
    send_auth_ok(socket, authed).await?;
    let machines = bus
        .snapshot(sid)
        .await?
        .into_iter()
        .filter_map(|(state, online)| match serde_json::from_str(&state) {
            Ok(state) => Some(SnapshotEntry { state, online }),
            Err(err) => {
                tracing::warn!(%err, sid = &sid[..6], "dropping unparsable machine state");
                None
            }
        })
        .collect();
    send(socket, &Frame::new(Header::Snapshot { machines })).await?;
    Ok(subs)
}

async fn run(socket: &mut WebSocket, ctx: &Ctx, authed: &Authed) -> Result<Exit> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sid = authed.sid.as_str();
    let mid = authed.machine.as_ref().map(|m| m.id.as_str());
    let subs = match mid {
        Some(mid) => setup_gateway(socket, ctx, authed, mid, &tx).await?,
        None => setup_client(socket, ctx, authed, &tx).await?,
    };

    let mut bucket = TokenBucket::new(ctx.config.limits.rate, ctx.config.limits.burst);
    let mut throttled: HashSet<u64> = HashSet::new();
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut refresh = tokio::time::interval(REFRESH_EVERY);
    let mut last_seen = Instant::now();
    let mut owner = true;

    let exit = loop {
        tokio::select! {
            msg = socket.recv() => {
                last_seen = Instant::now();
                let (data, binary) = match msg {
                    Some(Ok(Message::Text(text))) => (text.as_bytes().to_vec(), false),
                    Some(Ok(Message::Binary(bytes))) => (bytes.to_vec(), true),
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break Exit::Closed,
                };
                let Ok(frame) = Frame::decode(&data, binary) else {
                    break Exit::Close(CLOSE_BAD_FRAME, "bad frame");
                };
                let handled = match mid {
                    Some(mid) => on_gateway_frame(ctx, authed, mid, frame, &mut bucket).await?,
                    None => on_client_frame(socket, ctx, authed, frame, &mut bucket, &mut throttled).await?,
                };
                if !handled {
                    break Exit::Close(CLOSE_BAD_FRAME, "frame not allowed");
                }
            }
            Some(payload) = rx.recv() => {
                if payload == KICK {
                    owner = false;
                    break Exit::Close(CLOSE_REPLACED, "replaced by another gateway");
                }
                forward(socket, payload).await?;
            }
            _ = ping.tick() => {
                if last_seen.elapsed() > PONG_TIMEOUT {
                    break Exit::Closed;
                }
                socket.send(Message::Ping(Default::default())).await?;
            }
            _ = refresh.tick(), if mid.is_some() => {
                let mid = mid.expect("gateway");
                if !ctx.bus.refresh_gateway(sid, mid, &authed.conn).await? {
                    owner = false;
                    break Exit::Close(CLOSE_REPLACED, "replaced by another gateway");
                }
            }
        }
    };

    drop(subs);
    if let (Some(mid), true) = (mid, owner) {
        ctx.bus.release_gateway(sid, mid, &authed.conn).await?;
        let offline = Header::Presence {
            mid: mid.to_owned(),
            online: false,
        };
        ctx.bus
            .publish(&clients_channel(sid), Frame::new(offline).encode_binary())
            .await?;
    }
    Ok(exit)
}

/// Gateway may send `state`, and `res` / `data` / `end` addressed `to` a client of its own space.
async fn on_gateway_frame(
    ctx: &Ctx,
    authed: &Authed,
    mid: &str,
    mut frame: Frame,
    bucket: &mut TokenBucket,
) -> Result<bool> {
    let sid = authed.sid.as_str();
    if let Header::State { state } = &frame.header {
        if state.pointer("/machine/id").and_then(|v| v.as_str()) != Some(mid) {
            return Ok(false);
        }
        if bucket.take() {
            ctx.bus.put_state(sid, mid, &state.to_string()).await?;
            ctx.bus
                .publish(&clients_channel(sid), frame.encode_binary())
                .await?;
        }
        return Ok(true);
    }
    let to = match &mut frame.header {
        Header::Res { to, mid: m, .. }
        | Header::Data {
            to,
            mid: m,
            from: None,
            ..
        }
        | Header::End {
            to,
            mid: m,
            from: None,
            ..
        } => {
            let Some(to) = to.take() else {
                return Ok(false);
            };
            *m = Some(mid.to_owned());
            to
        }
        _ => return Ok(false),
    };
    if !to.starts_with(&format!("{sid}.")) {
        tracing::warn!(
            sid = &sid[..6],
            mid,
            "dropped frame addressed outside the space"
        );
        return Ok(true);
    }
    if bucket.take() {
        ctx.bus
            .publish(&conn_channel(&to), frame.encode_binary())
            .await?;
    }
    Ok(true)
}

/// Client may send `call` / `data` / `end` addressed to a machine (`mid`) of its own space.
async fn on_client_frame(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    mut frame: Frame,
    bucket: &mut TokenBucket,
    throttled: &mut HashSet<u64>,
) -> Result<bool> {
    let (id, mid) = match &mut frame.header {
        Header::Call { id, mid, from, .. }
        | Header::Data {
            id,
            mid,
            from,
            to: None,
            ..
        }
        | Header::End {
            id,
            mid,
            from,
            to: None,
            ..
        } => {
            let Some(target) = mid.take().filter(|m| is_machine_id(m)) else {
                return Ok(false);
            };
            *from = Some(authed.conn.clone());
            (*id, target)
        }
        _ => return Ok(false),
    };
    let is_call = matches!(frame.header, Header::Call { .. });
    if !bucket.take() {
        let limited = RpcError::new("rate_limited", "too many messages");
        if is_call {
            send(socket, &error_res(id, mid, limited)).await?;
        } else if throttled.len() < MAX_THROTTLED && throttled.insert(id) {
            send(
                socket,
                &Frame::new(Header::End {
                    id,
                    e: Some(limited),
                    mid: Some(mid),
                    from: None,
                    to: None,
                }),
            )
            .await?;
        }
        return Ok(true);
    }
    throttled.clear();
    let delivered = ctx
        .bus
        .publish(&gateway_channel(&authed.sid, &mid), frame.encode_binary())
        .await?;
    if is_call && delivered == 0 {
        let offline = RpcError::new("machine_offline", "machine is offline");
        send(socket, &error_res(id, mid, offline)).await?;
    }
    Ok(true)
}

fn error_res(id: u64, mid: String, err: RpcError) -> Frame {
    Frame::new(Header::Res {
        id,
        ok: false,
        r: None,
        e: Some(err),
        mid: Some(mid),
        to: None,
    })
}
