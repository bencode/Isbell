//! A direct link to one machine (see `crate::rtc`), set up through the relay. Streams opened after
//! it is up use it; losing it ends them, and later streams use the relay again.

use std::sync::{Arc, Weak};
use std::time::Duration;

use isbell_proto::frame::{Frame, RpcError};
use serde_json::json;
use tokio::sync::mpsc;
use webrtc::data_channel::DataChannel;

use super::inflight::Inflight;
use super::link::Link;
use super::relay_io::to_inflight;
use super::{PeerLinks, Session};
use crate::rtc::{self, Description, Path, Peer};

/// Offer, answer and the channel opening together: room for both ends' gathering, as long as the
/// gateway gives the channel to open.
const DIRECT_WITHIN: Duration = Duration::from_secs(10);

impl Session {
    /// Opens a direct link to machine `mid`, unless one is open already; returns the way it goes
    /// when this call opened it. `ice`: STUN URLs. On failure streams keep using the relay; the
    /// error says why (`direct_failed`, or the machine's own answer).
    pub async fn direct(&self, mid: &str, ice: &[String]) -> Result<Option<Path>, RpcError> {
        let _opening = self.opening.lock().await;
        if self.peers.lock().expect("session poisoned").contains_key(mid) {
            return Ok(None);
        }
        let (mut peer, channel) = Peer::offerer(ice).await?;
        let opened = tokio::time::timeout(DIRECT_WITHIN, self.open(mid, &mut peer, &channel)).await;
        let opened = opened.unwrap_or_else(|_| {
            let message = format!("no direct link within {}s", DIRECT_WITHIN.as_secs());
            Err(RpcError::new("direct_failed", message))
        });
        if let Err(err) = opened {
            peer.close().await;
            return Err(err);
        }
        let path = peer.path().await;
        let (out, out_rx) = mpsc::unbounded_channel();
        self.peers.lock().expect("session poisoned").insert(mid.to_owned(), Link::peer(out));
        let (inflight, peers) = (self.inflight.clone(), Arc::downgrade(&self.peers));
        self.spawn(serve(peer, channel, out_rx, mid.to_owned(), inflight, peers));
        Ok(path)
    }

    /// Offers through the relay, takes the machine's answer, and waits for the channel to open.
    async fn open(
        &self,
        mid: &str,
        peer: &mut Peer,
        channel: &Arc<dyn DataChannel>,
    ) -> Result<(), RpcError> {
        let offer = peer.offer().await?;
        let p = json!({"offer": offer});
        let mut r = self.call(mid, "isbell.rtc.offer", p, Some(DIRECT_WITHIN)).await?;
        let answer: Description = serde_json::from_value(r["answer"].take())
            .map_err(|err| RpcError::new("protocol_error", format!("rtc.offer answer: {err}")))?;
        peer.accept(answer).await?;
        Ok(rtc::opened(channel).await?)
    }
}

/// Answers the calls and streams on the link until it ends, then fails those still waiting. Holds
/// the session's links weakly, so dropping the session ends the link. The link leaves the session
/// only after its calls and streams failed: until then no other link to `mid` can exist, so the
/// failing never reaches one.
async fn serve(
    mut peer: Peer,
    channel: Arc<dyn DataChannel>,
    out: mpsc::UnboundedReceiver<Frame>,
    mid: String,
    inflight: Inflight,
    peers: Weak<PeerLinks>,
) {
    rtc::carry(&mut peer, channel, out, |frame| to_inflight(frame, &inflight)).await;
    let lost = RpcError::new("disconnected", "lost the direct link to the machine");
    inflight.fail(lost, |t| t.mid == mid && t.direct);
    if let Some(peers) = peers.upgrade() {
        peers.lock().expect("session poisoned").retain(|_, link| !link.is_closed());
    }
    peer.close().await;
}
