//! Client rate limits, gateway backpressure, and connections too slow to keep.

mod common;

use common::*;
use isbell_proto::frame::CLOSE_TOO_SLOW;

#[tokio::test]
async fn rate_limits_clients() {
    let relay = start(Limits { rate: 0.1, burst: 2.0, ..Limits::default() }).await;
    let (mut client, _) = Peer::client(&relay, &Identity::generate()).await;
    let mid = random_mid();
    for id in 1..=3 {
        client.send(call(id, &mid)).await;
    }
    let mut got = Vec::new();
    for _ in 0..3 {
        got.push(error_code(&client.recv().await).map(str::to_owned));
    }
    assert_eq!(
        got,
        ["machine_offline", "machine_offline", "rate_limited"].map(|c| Some(c.to_owned()))
    );
}

#[tokio::test]
async fn gateway_bursts_are_slowed_down_not_dropped() {
    let relay = start(Limits {
        gateway_bytes_per_sec: 64.0 * 1024.0,
        gateway_burst_bytes: 64.0 * 1024.0,
        ..Limits::default()
    })
    .await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    // 300 KiB against a 64 KiB/s budget: the relay must hold back, never drop.
    for n in 0..300u64 {
        let body = n.to_be_bytes().repeat(128);
        gateway.send(data(n, DataKind::Frame, None, Some(&client.conn), body)).await;
    }
    for n in 0..300u64 {
        let got = client.recv().await;
        assert!(matches!(got.header, Header::Data { id, .. } if id == n), "frame {n} in order");
        assert_eq!(got.body.unwrap()[..8], n.to_be_bytes());
    }
}

#[tokio::test]
async fn rate_limited_streams_end_on_both_sides() {
    let relay = start(Limits { rate: 0.1, burst: 1.0, ..Limits::default() }).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    client.send(data(7, DataKind::Input, Some(&mid), None, b"a".to_vec())).await;
    assert!(matches!(gateway.recv().await.header, Header::Data { id: 7, .. }));

    // Over the limit: the client is told, and the gateway hears the stream end.
    client.send(data(7, DataKind::Input, Some(&mid), None, b"b".to_vec())).await;
    assert_eq!(error_code(&client.recv().await), Some("rate_limited"));
    let Header::End { id: 7, from: Some(from), e: None, .. } = gateway.recv().await.header else {
        panic!("expected the gateway to get end");
    };
    assert_eq!(from, client.conn);

    // Later frames of the ended stream go nowhere.
    client.send(data(7, DataKind::Input, Some(&mid), None, b"c".to_vec())).await;
    assert!(gateway.recv_quiet().await.is_none());
}

#[tokio::test]
async fn a_client_that_falls_behind_is_closed_not_buffered_for() {
    let relay = start(Limits {
        inbox_frames: 8,
        gateway_bytes_per_sec: 1e9,
        gateway_burst_bytes: 1e9,
        ..Limits::default()
    })
    .await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut slow, _) = Peer::client(&relay, &id).await;
    let (mut other, _) = Peer::client(&relay, &id).await;

    // Far more than the socket buffers between the relay and the client hold, unread.
    for n in 0..600u64 {
        gateway.send(data(n, DataKind::Frame, None, Some(&slow.conn), vec![0; 60 * 1024])).await;
    }
    assert_eq!(slow.closed_with().await, CLOSE_TOO_SLOW);

    gateway.send(data(1, DataKind::Frame, None, Some(&other.conn), b"hi".to_vec())).await;
    assert!(matches!(other.recv().await.header, Header::Data { id: 1, .. }));
}
