//! Registering a new connection with the bus. Changes only when connection setup changes.

use anyhow::Result;
use axum::extract::ws::WebSocket;
use isbell_proto::frame::{Frame, Header, SnapshotEntry};
use tokio::sync::mpsc::UnboundedSender;

use super::{Authed, KICK, wire};
use crate::Ctx;
use crate::bus::{Subscription, clients_channel, conn_channel, gateway_channel};

/// Claims the machine (kicking a previous owner), subscribes, announces presence, then acks auth.
pub async fn gateway(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    mid: &str,
    inbox: &UnboundedSender<Vec<u8>>,
) -> Result<Vec<Subscription>> {
    let (bus, sid) = (&ctx.bus, authed.sid.as_str());
    if let Some(previous) = bus.claim_gateway(sid, mid, &authed.conn).await? {
        bus.publish(&conn_channel(&previous), KICK.to_vec()).await?;
    }
    let subs = vec![
        bus.subscribe(&gateway_channel(sid, mid), inbox.clone()).await?,
        bus.subscribe(&conn_channel(&authed.conn), inbox.clone()).await?,
    ];
    let online = Header::Presence { mid: mid.to_owned(), online: true };
    bus.publish(&clients_channel(sid), Frame::new(online).encode_binary()).await?;
    ack(socket, authed).await?;
    Ok(subs)
}

/// Subscribes before reading the snapshot so no state change between the two is missed.
pub async fn client(
    socket: &mut WebSocket,
    ctx: &Ctx,
    authed: &Authed,
    inbox: &UnboundedSender<Vec<u8>>,
) -> Result<Vec<Subscription>> {
    let (bus, sid) = (&ctx.bus, authed.sid.as_str());
    let subs = vec![
        bus.subscribe(&clients_channel(sid), inbox.clone()).await?,
        bus.subscribe(&conn_channel(&authed.conn), inbox.clone()).await?,
    ];
    ack(socket, authed).await?;
    let machines = bus
        .snapshot(sid)
        .await?
        .into_iter()
        .filter_map(|(state, online)| match serde_json::from_str(&state) {
            Ok(state) => Some(SnapshotEntry { state, online }),
            Err(err) => {
                tracing::warn!(%err, "dropping unparsable machine state");
                None
            }
        })
        .collect();
    wire::send(socket, &Frame::new(Header::Snapshot { machines })).await?;
    Ok(subs)
}

/// Sent only once the connection is routable, so a gateway that sees `auth_ok` can already receive calls.
async fn ack(socket: &mut WebSocket, authed: &Authed) -> Result<()> {
    let ok = Header::AuthOk { sid: authed.sid.clone(), conn: authed.conn.clone() };
    wire::send(socket, &Frame::new(ok)).await
}
