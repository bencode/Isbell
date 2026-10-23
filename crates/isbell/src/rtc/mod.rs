//! A direct link to one peer: a WebRTC peer connection with one DataChannel, set up by exchanging
//! descriptions through the relay. The library does the networking (sockets, STUN, ICE, DTLS,
//! SCTP); this is only the glue.
//!
//! ```text
//! offerer  ─▶ offer  (through the relay)   ─▶ answerer
//! offerer  ◀─ answer                        ◀─ answerer
//! channel "isbell" opens; frames go both ways (see `carry`)
//! ```

mod channel;
mod path;

use std::sync::Arc;
use std::time::Duration;

use isbell_proto::frame::RpcError;
use tokio::sync::{mpsc, watch};
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
    RTCIceCandidateType, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionIceEvent,
    RTCPeerConnectionState,
};

pub use self::channel::carry;
pub use self::path::Path;

/// An offer or answer; serializes as `{"type", "sdp"}`, like a browser's.
pub type Description = webrtc::peer_connection::RTCSessionDescription;

/// Descriptions go out once a server-reflexive candidate exists, or after this; finishing the
/// gathering can take seconds longer on interfaces no STUN server answers.
const GATHER_WITHIN: Duration = Duration::from_secs(1);
/// The library blocks `send` while this much is queued.
const SEND_BUFFER: usize = 1 << 20;
const LABEL: &str = "isbell";

#[derive(Debug, thiserror::Error)]
pub enum RtcError {
    #[error("webrtc: {0}")]
    Webrtc(String),
    #[error("the peer connection closed")]
    Closed,
}

/// A direct link that could not be set up; the caller keeps the relay.
impl From<RtcError> for RpcError {
    fn from(err: RtcError) -> Self {
        RpcError::new("direct_failed", err.to_string())
    }
}

fn webrtc_error(err: impl std::fmt::Display) -> RtcError {
    RtcError::Webrtc(err.to_string())
}

/// What the library reports, as channels the peer reads. Sends fail only once the peer is gone,
/// when nothing waits for them any more.
struct Handler {
    gathered: mpsc::UnboundedSender<()>,
    state: watch::Sender<RTCPeerConnectionState>,
    channels: mpsc::UnboundedSender<Arc<dyn DataChannel>>,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if event.candidate.typ == RTCIceCandidateType::Srflx {
            let _ = self.gathered.send(());
        }
    }
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gathered.send(());
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        self.state.send_replace(state);
    }
    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        let _ = self.channels.send(channel);
    }
}

pub struct Peer {
    pc: Box<dyn PeerConnection>,
    gathered: mpsc::UnboundedReceiver<()>,
    state: watch::Receiver<RTCPeerConnectionState>,
    channels: mpsc::UnboundedReceiver<Arc<dyn DataChannel>>,
}

impl Peer {
    /// The side that opens the channel. `ice`: STUN URLs (`stun:host:port`); none means host
    /// candidates only.
    pub async fn offerer(ice: &[String]) -> Result<(Peer, Arc<dyn DataChannel>), RtcError> {
        let peer = Peer::new(ice).await?;
        let channel = peer.pc.create_data_channel(LABEL, None).await.map_err(webrtc_error)?;
        Ok((peer, channel))
    }

    pub async fn answerer(ice: &[String]) -> Result<Peer, RtcError> {
        Peer::new(ice).await
    }

    async fn new(ice: &[String]) -> Result<Peer, RtcError> {
        let (gathered_tx, gathered) = mpsc::unbounded_channel();
        let (state_tx, state) = watch::channel(RTCPeerConnectionState::New);
        let (channels_tx, channels) = mpsc::unbounded_channel();
        let handler = Handler { gathered: gathered_tx, state: state_tx, channels: channels_tx };
        let servers = match ice.is_empty() {
            true => vec![],
            false => vec![RTCIceServer { urls: ice.to_vec(), ..Default::default() }],
        };
        let pc = PeerConnectionBuilder::new()
            .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(servers).build())
            .with_handler(Arc::new(handler))
            .with_udp_addrs(vec!["0.0.0.0:0".to_owned()])
            .with_data_channel_send_buffer_limit(SEND_BUFFER)
            .build()
            .await
            .map_err(webrtc_error)?;
        Ok(Peer { pc: Box::new(pc), gathered, state, channels })
    }

    pub async fn offer(&mut self) -> Result<Description, RtcError> {
        let offer = self.pc.create_offer(None).await.map_err(webrtc_error)?;
        self.pc.set_local_description(offer).await.map_err(webrtc_error)?;
        self.gathered().await
    }

    pub async fn answer(&mut self, offer: Description) -> Result<Description, RtcError> {
        self.pc.set_remote_description(offer).await.map_err(webrtc_error)?;
        let answer = self.pc.create_answer(None).await.map_err(webrtc_error)?;
        self.pc.set_local_description(answer).await.map_err(webrtc_error)?;
        self.gathered().await
    }

    pub async fn accept(&self, answer: Description) -> Result<(), RtcError> {
        self.pc.set_remote_description(answer).await.map_err(webrtc_error)
    }

    /// The answerer's side of the channel, once the offerer opened it.
    pub async fn channel(&mut self) -> Result<Arc<dyn DataChannel>, RtcError> {
        let channel = self.channels.recv().await.ok_or(RtcError::Closed)?;
        opened(&channel).await?;
        Ok(channel)
    }

    pub async fn close(self) {
        if let Err(err) = self.pc.close().await {
            tracing::debug!(%err, "closing a peer connection failed");
        }
    }

    /// The local description with the candidates gathered so far (see `GATHER_WITHIN`).
    async fn gathered(&mut self) -> Result<Description, RtcError> {
        if tokio::time::timeout(GATHER_WITHIN, self.gathered.recv()).await.is_err() {
            tracing::debug!("sending the candidates gathered so far");
        }
        let local = self.pc.local_description().await;
        local.ok_or_else(|| RtcError::Webrtc("no local description".into()))
    }
}

/// Waits until `channel` is open.
pub async fn opened(channel: &Arc<dyn DataChannel>) -> Result<(), RtcError> {
    loop {
        match channel.poll().await {
            Some(DataChannelEvent::OnOpen) => return Ok(()),
            Some(DataChannelEvent::OnClose) | None => return Err(RtcError::Closed),
            Some(DataChannelEvent::OnMessage(_)) => {
                tracing::warn!("a message arrived before the channel opened; dropped")
            }
            Some(_) => {}
        }
    }
}

/// A connection in either state is over; `Disconnected` may still recover by itself.
fn over(state: &RTCPeerConnectionState) -> bool {
    matches!(state, RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::frame::{Frame, Header};

    fn end(id: u64) -> Frame {
        Frame::new(Header::End { id, e: None, mid: None, from: None, to: None })
    }

    /// Carries frames for `peer` in a task: frames sent on the returned sender go out, frames that
    /// arrive come out of the receiver, and the task ends when the link does.
    fn spawn_carry(
        mut peer: Peer,
        channel: Arc<dyn DataChannel>,
    ) -> (mpsc::UnboundedSender<Frame>, mpsc::UnboundedReceiver<Frame>, tokio::task::JoinHandle<Peer>)
    {
        let (out, out_rx) = mpsc::unbounded_channel();
        let (arrived_tx, arrived) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            carry(&mut peer, channel, out_rx, |frame| drop(arrived_tx.send(frame))).await;
            peer
        });
        (out, arrived, task)
    }

    async fn within<T>(what: &str, f: impl Future<Output = T>) -> T {
        tokio::time::timeout(Duration::from_secs(30), f).await.unwrap_or_else(|_| panic!("{what}"))
    }

    #[tokio::test]
    async fn peers_carry_frames_both_ways_until_one_closes() {
        let (mut offerer, ours) = Peer::offerer(&[]).await.unwrap();
        let mut answerer = Peer::answerer(&[]).await.unwrap();
        let answer = answerer.answer(offerer.offer().await.unwrap()).await.unwrap();
        offerer.accept(answer).await.unwrap();
        within("the offerer's channel opens", opened(&ours)).await.unwrap();
        let theirs = within("the answerer's channel opens", answerer.channel()).await.unwrap();

        let (offerer_out, mut offerer_in, offering) = spawn_carry(offerer, ours);
        let (answerer_out, mut answerer_in, answering) = spawn_carry(answerer, theirs);
        offerer_out.send(end(1)).unwrap();
        assert_eq!(within("offerer → answerer", answerer_in.recv()).await, Some(end(1)));
        answerer_out.send(end(2)).unwrap();
        assert_eq!(within("answerer → offerer", offerer_in.recv()).await, Some(end(2)));

        // The offerer is done with the link: the answerer's side ends too.
        drop(offerer_out);
        within("the offerer's side ends", offering).await.unwrap().close().await;
        within("the answerer's side ends", answering).await.unwrap().close().await;
        assert!(answerer_out.is_closed(), "senders see the ended link closed");
    }
}
