//! Frames over an open DataChannel, one frame per binary message.

use std::sync::Arc;

use bytes::BytesMut;
use isbell_proto::frame::Frame;
use tokio::sync::mpsc;
use webrtc::data_channel::{DataChannel, DataChannelEvent};

use super::{Peer, over};
use crate::AbortOnDrop;

/// Sends the frames from `out` and hands the frames that arrive to `arrived`, until the channel
/// closes, the connection fails or closes, or every sender of `out` is gone. Once it returns, `out`
/// is dropped, so senders see the link closed.
pub async fn carry(
    peer: &mut Peer,
    channel: Arc<dyn DataChannel>,
    out: mpsc::UnboundedReceiver<Frame>,
    mut arrived: impl FnMut(Frame),
) {
    // Its own task, so a full send buffer never stops frames from being read.
    let mut writer = AbortOnDrop(tokio::spawn(write(Arc::clone(&channel), out)));
    let written = loop {
        tokio::select! {
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnMessage(msg)) => match Frame::decode(&msg.data, !msg.is_string) {
                    Ok(frame) => arrived(frame),
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

async fn write(channel: Arc<dyn DataChannel>, mut out: mpsc::UnboundedReceiver<Frame>) {
    while let Some(frame) = out.recv().await {
        if let Err(err) = channel.send(BytesMut::from(&frame.encode_binary()[..])).await {
            tracing::debug!(%err, "direct link write failed");
            break;
        }
    }
}
