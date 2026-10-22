//! Which gateway connection owns a machine, and what clients see of it.

mod common;

use common::*;
use isbell_relay::CLOSE_REPLACED;

#[tokio::test]
async fn newer_gateway_replaces_older() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut first = Peer::gateway(&relay, &id, &mid).await;
    let mut second = Peer::gateway(&relay, &id, &mid).await;
    assert_eq!(first.closed_with().await, CLOSE_REPLACED);

    let (mut client, _) = Peer::client(&relay, &id).await;
    client.send(call(1, &mid)).await;
    assert!(matches!(
        second.recv().await.header,
        Header::Call { id: 1, .. }
    ));
}

#[tokio::test]
async fn late_clients_get_snapshot_and_presence() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut early, _) = Peer::client(&relay, &id).await;

    let state = json!({"machine": {"id": mid}, "agents": []});
    gateway
        .send(Frame::new(Header::State {
            state: state.clone(),
        }))
        .await;
    assert_eq!(
        early.recv().await.header,
        Header::State {
            state: state.clone()
        }
    );

    let (mut late, snapshot) = Peer::client(&relay, &id).await;
    assert_eq!(snapshot, vec![(state, true)]);

    drop(gateway);
    assert_eq!(
        late.recv().await.header,
        Header::Presence { mid, online: false }
    );
}

#[tokio::test]
async fn gateway_survives_lost_ownership_key() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;

    // Simulates a Redis restart or flush: the ownership key disappears.
    let key = format!("isb:{}:m:{mid}:conn", id.sid());
    let mut redis = redis::Client::open(redis_url())
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: i64 = redis::AsyncCommands::del(&mut redis, &key).await.unwrap();

    // The next refresh (every 10s) re-claims the machine instead of treating it as taken over.
    let restored = async {
        loop {
            let owner: Option<String> = redis::AsyncCommands::get(&mut redis, &key).await.unwrap();
            if owner.as_deref() == Some(gateway.conn.as_str()) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(15), restored)
        .await
        .expect("ownership restored within 15s");

    // Still connected: a call reaches it (a replaced gateway would have been closed with 4001).
    let (mut client, _) = Peer::client(&relay, &id).await;
    client.send(call(1, &mid)).await;
    assert!(matches!(
        gateway.recv().await.header,
        Header::Call { id: 1, .. }
    ));
}

#[tokio::test]
async fn release_reports_whether_the_machine_is_left_unowned() {
    let bus = isbell_relay::bus::Bus::connect(&redis_url()).await.unwrap();
    let (sid, mid) = (Identity::generate().sid(), random_mid());
    assert_eq!(bus.claim_gateway(&sid, &mid, "a").await.unwrap(), None);
    assert!(
        !bus.release_gateway(&sid, &mid, "b").await.unwrap(),
        "a still owns it"
    );
    assert!(
        bus.release_gateway(&sid, &mid, "a").await.unwrap(),
        "released by its owner"
    );
    assert!(
        bus.release_gateway(&sid, &mid, "a").await.unwrap(),
        "already unowned"
    );
}
