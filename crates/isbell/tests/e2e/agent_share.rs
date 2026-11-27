//! An agent share: its guests see and reach only the panes shared, which the owner changes while
//! they are connected, until it is stopped.

use std::time::{SystemTime, UNIX_EPOCH};

use isbell::client::{Session, SessionEvent};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineState;
use serde_json::{Value, json};

use crate::checks::{Events, next_event};

pub async fn guests_reach_only_what_is_shared(owner: &Session, mid: &str, url: &str) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    let put = |panes: &[&str], key: Option<&Value>| {
        let mut p = json!({"name": "guest", "expiresAt": now + 60 * 60 * 1000, "panes": panes});
        if let Some(key) = key {
            p["key"] = key.clone();
        }
        p
    };
    let shared =
        owner.call(mid, "isbell.agentShare.put", put(&["w1:p1"], None), None).await.unwrap();
    let key = Identity::parse(shared["key"].as_str().unwrap()).unwrap();
    let guest = Session::connect(url, &key).await.unwrap();
    let mut events = guest.events();

    let state = shown(&guest, &mut events, mid, |s| !s.agents.is_empty()).await;
    assert_eq!(panes(&state), ["w1:p1"]);
    assert!(state.machine.hostname.is_empty(), "guests are not told the hostname");

    let read = |target: &str| json!({"method": "agent.read", "params": {"target": target, "source": "recent"}});
    let text = guest.call(mid, "herdr", read("w1:p1"), None).await.unwrap();
    assert_eq!(text["read"]["text"], "hello from herdr");
    let other = guest.call(mid, "herdr", read("w2:p1"), None).await.unwrap_err();
    assert_eq!(other.code, "not_shared");
    let files = guest.call(mid, "isbell.file.list", json!({"path": "/"}), None).await.unwrap_err();
    assert_eq!(files.code, "method_not_allowed");

    // Shared one more, with the same key: the guest sees it at once.
    let more = put(&["w1:p1", "w2:p1"], Some(&shared["key"]));
    assert_eq!(owner.call(mid, "isbell.agentShare.put", more, None).await.unwrap(), shared);
    let state = shown(&guest, &mut events, mid, |s| s.agents.len() == 2).await;
    assert_eq!(panes(&state), ["w1:p1", "w2:p1"]);
    let list = owner.call(mid, "isbell.agentShare.list", json!({}), None).await.unwrap();
    assert_eq!(list[0]["id"], shared["id"]);
    assert!(list[0].get("key").is_none(), "the owner's list holds no key");

    // Stopped: the guest sees the machine go.
    let stop = json!({"id": shared["id"]});
    owner.call(mid, "isbell.agentShare.stop", stop, None).await.unwrap();
    loop {
        if let SessionEvent::Presence { mid: m, online: false } = next_event(&mut events).await
            && m == mid
        {
            break;
        }
    }
}

/// The machine's state as the guest sees it, once `wanted` holds of it.
async fn shown(
    guest: &Session,
    events: &mut Events,
    mid: &str,
    wanted: impl Fn(&MachineState) -> bool,
) -> MachineState {
    let known = guest.machines().into_iter().map(|(s, _)| s);
    if let Some(state) = known.into_iter().find(|s| s.machine.id == mid && wanted(s)) {
        return state;
    }
    loop {
        if let SessionEvent::State(state) = next_event(events).await
            && state.machine.id == mid
            && wanted(&state)
        {
            return *state;
        }
    }
}

fn panes(state: &MachineState) -> Vec<&str> {
    state.agents.iter().map(|a| a.pane_id.as_str()).collect()
}
