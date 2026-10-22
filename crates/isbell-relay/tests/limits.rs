//! Client rate limits and gateway backpressure.

mod common;

use common::*;

#[tokio::test]
async fn rate_limits_clients() {
    let relay = start(Limits {
        rate: 0.1,
        burst: 2.0,
        ..Limits::default()
    })
    .await;
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
        gateway
            .send(data(n, DataKind::Frame, None, Some(&client.conn), body))
            .await;
    }
    for n in 0..300u64 {
        let got = client.recv().await;
        assert!(
            matches!(got.header, Header::Data { id, .. } if id == n),
            "frame {n} in order"
        );
        assert_eq!(got.body.unwrap()[..8], n.to_be_bytes());
    }
}

#[tokio::test]
async fn rate_limited_streams_end_on_both_sides() {
    let relay = start(Limits {
        rate: 0.1,
        burst: 1.0,
        ..Limits::default()
    })
    .await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    client
        .send(data(7, DataKind::Input, Some(&mid), None, b"a".to_vec()))
        .await;
    assert!(matches!(
        gateway.recv().await.header,
        Header::Data { id: 7, .. }
    ));

    // Over the limit: the client is told, and the gateway hears the stream end.
    client
        .send(data(7, DataKind::Input, Some(&mid), None, b"b".to_vec()))
        .await;
    assert_eq!(error_code(&client.recv().await), Some("rate_limited"));
    let Header::End {
        id: 7,
        from: Some(from),
        e: None,
        ..
    } = gateway.recv().await.header
    else {
        panic!("expected the gateway to get end");
    };
    assert_eq!(from, client.conn);

    // Later frames of the ended stream go nowhere.
    client
        .send(data(7, DataKind::Input, Some(&mid), None, b"c".to_vec()))
        .await;
    assert!(gateway.recv_quiet().await.is_none());
}
