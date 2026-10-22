//! What happens to calls in flight when the gateway reconnects, is taken over, or goes offline.

use std::sync::Arc;
use std::time::Duration;

use isbell::client::{Session, SessionEvent};
use isbell::gateway::GatewayError;
use isbell::relay::RelayError;
use isbell_proto::frame::RpcError;
use serde_json::{Value, json};
use tokio::task::JoinHandle;

use crate::checks::{Events, next_event};
use crate::fake_herdr::Calls;
use crate::harness::Harness;

/// The gateway loses its network and reconnects while the relay still holds the old connection:
/// the call in flight is answered over the new connection.
pub async fn reconnect(session: &Arc<Session>, events: &mut Events, harness: &Harness) {
    let mid = &harness.machine.id;
    let waiting = start_wait(session, mid);
    wait_for_calls(&harness.herdr.calls, "agent.wait", 1).await;
    harness.forwarder.cut(1);
    wait_for_presence(events, mid, true).await; // reconnected (link 2), never seen offline
    harness.herdr.release_wait.notify_one();
    let answered = finished(waiting).await.expect("response delivered after reconnect");
    assert_eq!(answered["type"], "agent_info");
}

/// A new gateway process takes over the machine: calls sent to the old one fail.
pub async fn takeover(
    session: &Arc<Session>,
    events: &mut Events,
    harness: &Harness,
    old: JoinHandle<Result<(), GatewayError>>,
) -> JoinHandle<Result<(), GatewayError>> {
    let mid = &harness.machine.id;
    let waiting = start_wait(session, mid);
    wait_for_calls(&harness.herdr.calls, "agent.wait", 2).await;
    tokio::time::sleep(Duration::from_millis(5)).await; // a later boot timestamp
    let new = harness.spawn_gateway(); // link 3
    let lost = finished(waiting).await.unwrap_err();
    assert_eq!(lost.code, "machine_offline");
    assert!(matches!(finished(old).await, Err(GatewayError::Relay(RelayError::Replaced))));
    wait_for_presence(events, mid, true).await; // the takeover is never seen as offline
    new
}

/// The gateway goes offline: calls in flight fail and clients see the machine offline.
pub async fn offline(
    session: &Arc<Session>,
    events: &mut Events,
    harness: &Harness,
    gateway: JoinHandle<Result<(), GatewayError>>,
) {
    let mid = &harness.machine.id;
    let waiting = start_wait(session, mid);
    wait_for_calls(&harness.herdr.calls, "agent.wait", 3).await;
    gateway.abort();
    let lost = finished(waiting).await.unwrap_err();
    assert_eq!(lost.code, "machine_offline");
    wait_for_presence(events, mid, false).await;
}

async fn wait_for_presence(events: &mut Events, mid: &str, online: bool) {
    loop {
        if let SessionEvent::Presence { mid: m, online: o } = next_event(events).await
            && m == mid
        {
            assert_eq!(o, online, "unexpected presence");
            return;
        }
    }
}

/// Waits until herdr has received `n` calls of `method`.
async fn wait_for_calls(calls: &Calls, method: &str, n: usize) {
    let arrived = async {
        while calls.lock().unwrap().iter().filter(|(m, _)| m == method).count() < n {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), arrived)
        .await
        .unwrap_or_else(|_| panic!("{method} #{n} not received within 10s"));
}

/// An `agent.wait` without a timeout, as `isbell agent wait` sends it.
fn start_wait(session: &Arc<Session>, mid: &str) -> JoinHandle<Result<Value, RpcError>> {
    let (session, mid) = (Arc::clone(session), mid.to_owned());
    tokio::spawn(async move {
        let wait = json!({"method": "agent.wait", "params": {"target": "reviewer"}});
        session.call(&mid, "herdr", wait, None).await
    })
}

async fn finished<T>(task: JoinHandle<T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), task).await.expect("finished within 10s").unwrap()
}
