//! Routing between clients and gateways of a space.

mod common;

use common::*;

#[tokio::test]
async fn call_to_offline_machine_fails() {
    let relay = start(Limits::default()).await;
    let (mut client, _) = Peer::client(&relay, &Identity::generate()).await;
    client.send(call(1, &random_mid())).await;
    assert_eq!(error_code(&client.recv().await), Some("machine_offline"));
}

#[tokio::test]
async fn routes_calls_and_responses() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    client.send(call(7, &mid)).await;
    let Header::Call { id: 7, mid: None, from: Some(from), .. } = gateway.recv().await.header
    else {
        panic!("expected routed call")
    };
    assert_eq!(from, client.conn);

    gateway
        .send(Frame::new(Header::Res {
            id: 7,
            ok: true,
            r: Some(json!(["a"])),
            e: None,
            mid: None,
            to: Some(from.clone()),
        }))
        .await;
    let Header::Res { id: 7, ok: true, r, mid: Some(m), to: None, .. } = client.recv().await.header
    else {
        panic!("expected res")
    };
    assert_eq!((r, m.as_str()), (Some(json!(["a"])), mid.as_str()));
}

#[tokio::test]
async fn routes_stream_data_both_ways() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    let output = vec![0u8, 1, 2, 3, 255];
    gateway.send(data(7, DataKind::Frame, None, Some(&client.conn), output.clone())).await;
    let got = client.recv().await;
    assert!(
        matches!(got.header, Header::Data { id: 7, k: DataKind::Frame, mid: Some(ref m), .. } if *m == mid)
    );
    assert_eq!(got.body, Some(output));

    client.send(data(7, DataKind::Input, Some(&mid), None, b"ls\r".to_vec())).await;
    let got = gateway.recv().await;
    assert!(
        matches!(got.header, Header::Data { k: DataKind::Input, from: Some(ref f), .. } if *f == client.conn)
    );
    assert_eq!(got.body.as_deref(), Some(&b"ls\r"[..]));

    // Credit flows from a stream's receiver to its sender, either way.
    let credit = |mid: Option<&str>, to: Option<&str>| {
        let (mid, to) = (mid.map(str::to_owned), to.map(str::to_owned));
        Frame::new(Header::Credit { id: 7, n: 1 << 20, mid, from: None, to })
    };
    client.send(credit(Some(&mid), None)).await;
    let got = gateway.recv().await;
    assert!(
        matches!(got.header, Header::Credit { n: 1048576, from: Some(ref f), .. } if *f == client.conn)
    );
    gateway.send(credit(None, Some(&client.conn))).await;
    let got = client.recv().await;
    assert!(matches!(got.header, Header::Credit { id: 7, mid: Some(ref m), .. } if *m == mid));
}

#[tokio::test]
async fn spaces_are_isolated() {
    let relay = start(Limits::default()).await;
    let (a, b) = (Identity::generate(), Identity::generate());
    let mid = random_mid();
    let mut gateway_a = Peer::gateway(&relay, &a, &mid).await;
    let (mut client_b, _) = Peer::client(&relay, &b).await;

    client_b.send(call(1, &mid)).await;
    assert_eq!(error_code(&client_b.recv().await), Some("machine_offline"));
    assert!(gateway_a.recv_quiet().await.is_none());

    let forged = Header::Res {
        id: 1,
        ok: true,
        r: None,
        e: None,
        mid: None,
        to: Some(client_b.conn.clone()),
    };
    gateway_a.send(Frame::new(forged)).await;
    assert!(client_b.recv_quiet().await.is_none());
}
