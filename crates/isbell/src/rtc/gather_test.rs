use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use tokio::net::UdpSocket;

use super::{Peer, tally};
use crate::AbortOnDrop;

/// A local STUN responder with a controlled delay and a documentation-range mapped address.
async fn stun(ipv6: bool, delay: Duration) -> (String, AbortOnDrop<()>) {
    let host = if ipv6 { IpAddr::V6(Ipv6Addr::LOCALHOST) } else { IpAddr::V4(Ipv4Addr::LOCALHOST) };
    let socket = UdpSocket::bind(SocketAddr::new(host, 0)).await.unwrap();
    let url = format!("stun:{}", socket.local_addr().unwrap());
    let mapped = if ipv6 {
        Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1).octets().to_vec()
    } else {
        Ipv4Addr::new(192, 0, 2, 1).octets().to_vec()
    };
    let task = tokio::spawn(async move {
        let mut request = [0; 1_024];
        loop {
            let (len, peer) = socket.recv_from(&mut request).await.unwrap();
            assert!(len >= 20);
            assert_eq!(&request[..2], &[0, 1]);
            tokio::time::sleep(delay).await;
            // Binding success, followed by XOR-MAPPED-ADDRESS (RFC 8489).
            let mut response = vec![1, 1, 0, if ipv6 { 24 } else { 12 }];
            response.extend_from_slice(&request[4..20]);
            response.extend_from_slice(&[
                0,
                32,
                0,
                if ipv6 { 20 } else { 8 },
                0,
                if ipv6 { 2 } else { 1 },
            ]);
            response.extend_from_slice(&(peer.port() ^ 0x2112).to_be_bytes());
            response
                .extend(mapped.iter().zip(&request[4..20]).map(|(address, mask)| address ^ mask));
            if let Err(err) = socket.send_to(&response, peer).await {
                assert_eq!(err.kind(), std::io::ErrorKind::AddrNotAvailable);
                eprintln!("loopback STUN responder cannot reply to {peer}: {err}");
            }
        }
    });
    (url, AbortOnDrop(task))
}

#[tokio::test]
async fn a_late_public_address_family_is_included() {
    for delayed_ipv6 in [true, false] {
        let late = Duration::from_millis(800);
        let (v4, _v4_server) = stun(false, if delayed_ipv6 { Duration::ZERO } else { late }).await;
        let (v6, _v6_server) = stun(true, if delayed_ipv6 { late } else { Duration::ZERO }).await;
        let (mut peer, _channel) = Peer::offerer(&[v4, v6]).await.unwrap();
        let offer = peer.offer().await;
        peer.close().await;
        let candidates = tally(&offer.unwrap().sdp);
        assert!(candidates.contains("srflx/v4="), "missing IPv4: {candidates}");
        assert!(candidates.contains("srflx/v6="), "missing IPv6: {candidates}");
    }
}
