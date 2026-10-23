//! The WebSocket edge: frames in and out of one socket.

use anyhow::{Context, Result};
use axum::extract::ws::{CloseFrame, Message, WebSocket};
use isbell_proto::frame::{Encoded, Frame};

use super::WRITE_WITHIN;

pub enum Incoming {
    /// A text (`false`) or binary (`true`) message.
    Data(Vec<u8>, bool),
    /// Ping / pong: proof of life, nothing to handle.
    Control,
    /// The peer closed or the socket failed.
    Gone,
}

pub async fn recv(socket: &mut WebSocket) -> Incoming {
    match socket.recv().await {
        Some(Ok(Message::Text(text))) => Incoming::Data(text.as_bytes().to_vec(), false),
        Some(Ok(Message::Binary(bytes))) => Incoming::Data(bytes.to_vec(), true),
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => Incoming::Control,
        Some(Ok(Message::Close(_)) | Err(_)) | None => Incoming::Gone,
    }
}

/// The next text or binary message, skipping control messages; `None` once the peer is gone.
pub async fn recv_data(socket: &mut WebSocket) -> Option<(Vec<u8>, bool)> {
    loop {
        match recv(socket).await {
            Incoming::Data(data, binary) => return Some((data, binary)),
            Incoming::Control => {}
            Incoming::Gone => return None,
        }
    }
}

pub async fn send(socket: &mut WebSocket, frame: &Frame) -> Result<()> {
    write(socket, message(frame.encode())).await
}

/// Sends a pub/sub payload (always binary-framed) on as text or binary.
pub async fn forward(socket: &mut WebSocket, payload: Vec<u8>) -> Result<()> {
    write(socket, message(Encoded::from_binary(payload)?)).await
}

pub async fn ping(socket: &mut WebSocket) -> Result<()> {
    write(socket, Message::Ping(Default::default())).await
}

pub async fn close(mut socket: WebSocket, code: u16, reason: &'static str) {
    let frame = CloseFrame { code, reason: reason.into() };
    if let Err(err) = write(&mut socket, Message::Close(Some(frame))).await {
        tracing::debug!(%err, "close frame not delivered");
    }
}

/// Every write, so a peer that stops reading cannot stall its connection (and its heartbeat).
async fn write(socket: &mut WebSocket, msg: Message) -> Result<()> {
    let written = tokio::time::timeout(WRITE_WITHIN, socket.send(msg)).await;
    Ok(written.context("the peer took nothing for too long")??)
}

fn message(encoded: Encoded) -> Message {
    match encoded {
        Encoded::Text(text) => Message::Text(text.into()),
        Encoded::Binary(bytes) => Message::Binary(bytes.into()),
    }
}
