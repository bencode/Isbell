//! Which way a direct link's packets go: the ICE candidate pair in use. A candidate's type tells a
//! local address (`host`) from one learned through STUN (`srflx`) or from the peer (`prflx`). Before
//! a pair exists, the candidates each description carries tell which ways were on offer.

use std::collections::BTreeMap;
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

/// The candidates a description carries, by type and address family, e.g.
/// `host/mdns=1 srflx/v4=1`; `none` when it carries none.
pub fn tally(sdp: &str) -> String {
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> …
    let counts = sdp
        .lines()
        .filter_map(|line| line.strip_prefix("a=candidate:"))
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let typ = fields.iter().position(|f| *f == "typ").and_then(|i| fields.get(i + 1))?;
            Some((typ.to_string(), family(fields.get(4)?)))
        })
        .fold(BTreeMap::<_, usize>::new(), |mut counts, kind| {
            *counts.entry(kind).or_default() += 1;
            counts
        });
    if counts.is_empty() {
        return "none".to_owned();
    }
    let kinds: Vec<String> =
        counts.iter().map(|((typ, family), n)| format!("{typ}/{family}={n}")).collect();
    kinds.join(" ")
}

/// Browsers hide their local addresses behind mDNS names.
fn family(address: &str) -> &'static str {
    if address.ends_with(".local") {
        "mdns"
    } else if address.contains(':') {
        "v6"
    } else {
        "v4"
    }
}

#[cfg(test)]
mod tests {
    use super::tally;

    #[test]
    fn tally_counts_candidates_by_type_and_family() {
        let offer = "v=0\r\n\
            a=candidate:1 1 udp 2113937151 3f0c9a1e-77aa.local 54102 typ host generation 0\r\n\
            a=candidate:2 1 udp 1677729535 203.0.113.7 51234 typ srflx raddr 0.0.0.0 rport 0\r\n";
        assert_eq!(tally(offer), "host/mdns=1 srflx/v4=1");

        let answer = "a=candidate:1 1 udp 2130706431 192.168.3.25 61933 typ host\n\
            a=candidate:2 1 udp 2130706431 240e:390::1 61934 typ host\n\
            a=candidate:3 1 udp 2130706431 100.69.122.127 61935 typ host\n\
            a=candidate:4 1 udp 1694498815 125.120.43.207 61933 typ srflx raddr 0.0.0.0 rport 61933\n";
        assert_eq!(tally(answer), "host/v4=2 host/v6=1 srflx/v4=1");

        assert_eq!(tally("v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"), "none");
    }
}
