//! Which way a direct link's packets go: the ICE candidate pair in use. A candidate's type tells a
//! local address (`host`) from one learned through STUN (`srflx`) or from the peer (`prflx`).

use std::fmt;

use serde::Serialize;
use webrtc::peer_connection::RTCIceCandidate;

use super::Peer;

#[derive(Debug, Clone, Serialize)]
pub struct Path {
    /// `type address:port`, e.g. `srflx 203.0.113.7:51234`.
    pub local: String,
    pub remote: String,
}

impl fmt::Display for Path {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ↔ {}", self.local, self.remote)
    }
}

impl Peer {
    /// The pair ICE selected; `None` until it has one.
    pub async fn path(&self) -> Option<Path> {
        let ice = self.pc.sctp().await?.transport().ice_transport();
        match ice.get_selected_candidate_pair().await {
            Ok(pair) => pair.map(|pair| Path {
                local: candidate(pair.local()),
                remote: candidate(pair.remote()),
            }),
            Err(err) => {
                tracing::debug!(%err, "no selected candidate pair");
                None
            }
        }
    }
}

fn candidate(c: &RTCIceCandidate) -> String {
    format!("{} {}:{}", c.typ, c.address, c.port)
}
