//! Frames over an open DataChannel, one per binary message; a frame longer than one message goes
//! as pieces (`isbell_proto::frame::pieces`) when both ends agreed to them.

use std::sync::Arc;

use bytes::BytesMut;
use isbell_proto::frame::Frame;
use isbell_proto::frame::pieces::{self, Assembler, PIECE};
use tokio::sync::mpsc;
use webrtc::data_channel::{DataChannel, DataChannelEvent};

use super::{Peer, over};
use crate::AbortOnDrop;

/// Sends the frames from `out`, in pieces when they are long and `pieces` is agreed, and hands the
/// frames that arrive, whole or in pieces, to `arrived`; until the channel closes, the connection
/// fails or closes, or every sender of `out` is gone. Once it returns, `out` is dropped, so senders
/// see the link closed.
pub async fn carry(
    peer: &mut Peer,
    channel: Arc<dyn DataChannel>,
    out: mpsc::UnboundedReceiver<Frame>,
    pieces: bool,
    mut arrived: impl FnMut(Frame),
) {
    // Its own task, so a full send buffer never stops frames from being read.
    let mut writer = AbortOnDrop(tokio::spawn(write(Arc::clone(&channel), out, pieces)));
    let mut assembler = Assembler::default();
    let written = loop {
        tokio::select! {
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnMessage(msg)) => match assembler.push(&msg.data, !msg.is_string) {
                    Ok(Some(frame)) => arrived(frame),
                    Ok(None) => {}
                    Err(err) => tracing::warn!(%err, "ignoring an unreadable message"),
                },
                Some(DataChannelEvent::OnClose) | None => break false,
                Some(_) => {}
            },
            _ = peer.state.wait_for(over) => break false,
            _ = &mut writer.0 => break true,
        }
    };
    if !written {
        // Aborting only asks the writer to stop; waiting for it drops `out` before returning.
        writer.0.abort();
        if let Err(err) = (&mut writer.0).await
            && !err.is_cancelled()
        {
            tracing::error!(%err, "direct link writer failed");
        }
    }
}

async fn write(
    channel: Arc<dyn DataChannel>,
    mut out: mpsc::UnboundedReceiver<Frame>,
    pieces: bool,
) {
    while let Some(frame) = out.recv().await {
        let encoded = frame.encode_binary();
        let msgs = if pieces { pieces::split(encoded, PIECE) } else { vec![encoded] };
        for msg in msgs {
            if let Err(err) = channel.send(BytesMut::from(&msg[..])).await {
                tracing::debug!(%err, "direct link write failed");
                return;
            }
        }
    }
}
