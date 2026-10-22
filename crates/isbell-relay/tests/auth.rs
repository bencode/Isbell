//! Authentication and what each role may send.

mod common;

use common::*;
use isbell_relay::{CLOSE_AUTH_FAILED, CLOSE_AUTH_TIMEOUT, CLOSE_BAD_FRAME};

#[tokio::test]
async fn rejects_bad_signature() {
    let relay = start(Limits::default()).await;
    let (mut ws, nonce) = Peer::open(&relay).await;
    let id = Identity::generate();
    let auth = Header::Auth {
        role: Role::Client,
        pk: id.public_key(),
        sig: id.sign_auth(Role::Client, ORIGIN, &format!("{nonce}x")),
        machine: None,
    };
    send_on(&mut ws, Frame::new(auth)).await;
    assert_eq!(closed_on(&mut ws).await, CLOSE_AUTH_FAILED);
}

#[tokio::test]
async fn closes_unauthenticated_connections() {
    let relay = start(Limits::default()).await;
    let (mut ws, _) = Peer::open(&relay).await;
    assert_eq!(closed_on(&mut ws).await, CLOSE_AUTH_TIMEOUT);
}

#[tokio::test]
async fn rejects_frames_not_allowed_for_the_role() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let (mut client, _) = Peer::client(&relay, &id).await;
    client.send(Frame::new(Header::State { state: json!({}) })).await;
    assert_eq!(client.closed_with().await, CLOSE_BAD_FRAME);

    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    gateway
        .send(Frame::new(Header::State { state: json!({"machine": {"id": random_mid()}}) }))
        .await;
    assert_eq!(gateway.closed_with().await, CLOSE_BAD_FRAME);
}
