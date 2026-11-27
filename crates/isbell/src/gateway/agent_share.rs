//! Agent shares: a link that lets someone else talk with agents of this machine, as with their
//! own, while the user watches the same sessions here. Each share is a space of its own, as a file
//! share is: a key made for it, and a relay connection of its own as a gateway in that space, so a
//! guest holds no credential for the real space. Which panes it shows can change while it runs; the
//! same key can be given to the user's other machines, each showing its own agents in it. Shares
//! live in this process and end with it.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, MachineInfo, MachineState};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};

use super::calls::guests::{self, Guests};
use super::{HerdrSlot, uplink, workspace};
use crate::{AbortOnDrop, now_ms};

const SHORTEST: u64 = 60 * 1000;
const LONGEST: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_PANES: usize = 32;
const MAX_NAME: usize = 64;

type States = watch::Receiver<Option<MachineState>>;

/// The shares running, by id: the sid of the share's space, the same on every machine with its key.
pub struct AgentShares {
    running: Mutex<BTreeMap<String, Running>>,
    /// This machine's own space, whose key must never be a share's: serving it would take this
    /// machine's place there.
    space: String,
    /// Counts the shares started, to tell one from another started later with the same key.
    started: AtomicU64,
    relay: String,
    ice: Vec<String>,
    machine: MachineInfo,
    slot: HerdrSlot,
    /// This machine's state, which each share's is made from.
    states: States,
    /// Where the agent hook keeps its session records.
    records: Option<PathBuf>,
}

struct Running {
    key: String,
    /// The user's note of who it is for; only they see it.
    name: String,
    panes: watch::Sender<Vec<String>>,
    /// When it ends, in milliseconds since the epoch; dropped to end it now.
    expires_at: watch::Sender<u64>,
    started: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutParams {
    key: Option<String>,
    name: String,
    expires_at: u64,
    panes: Vec<String>,
}

impl PutParams {
    fn check(&self, now: u64) -> Result<(), RpcError> {
        let name = self.name.trim();
        if name.is_empty() || name.len() > MAX_NAME || name.chars().any(char::is_control) {
            return Err(RpcError::bad_request("the name is one line of 1 to 64 bytes"));
        }
        if !(now + SHORTEST..=now + LONGEST).contains(&self.expires_at) {
            return Err(RpcError::bad_request("a share lasts from a minute to seven days"));
        }
        if self.panes.len() > MAX_PANES || self.panes.iter().any(|p| p.is_empty()) {
            return Err(RpcError::bad_request("at most 32 panes, each by its id"));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

fn id_of(p: Value) -> Result<String, RpcError> {
    let IdParams { id } = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    Ok(id)
}

impl AgentShares {
    pub fn new(
        space: String,
        relay: String,
        ice: Vec<String>,
        machine: MachineInfo,
        slot: HerdrSlot,
        states: States,
    ) -> Arc<AgentShares> {
        Arc::new(AgentShares {
            running: Mutex::default(),
            space,
            started: AtomicU64::new(0),
            relay,
            ice,
            machine,
            slot,
            states,
            records: workspace::expand_home("~/.isbell/sessions"),
        })
    }

    /// Starts a share (with a new key, or the key another machine's share has), or changes the one
    /// running: its name, when it ends, and the panes it shows, at once to those connected.
    pub fn put(self: &Arc<Self>, p: Value) -> Result<Value, RpcError> {
        let req: PutParams = serde_json::from_value(p).map_err(RpcError::bad_request)?;
        req.check(now_ms())?;
        let identity = match &req.key {
            Some(key) => {
                Identity::parse(key).map_err(|err| RpcError::bad_request(err.to_string()))?
            }
            None => Identity::generate(),
        };
        let id = identity.sid();
        if id == self.space {
            return Err(RpcError::bad_request("a share needs a key of its own"));
        }
        let key = identity.key_string();
        let name = req.name.trim().to_owned();
        let mut running = self.running.lock().expect("agent shares poisoned");
        if let Some(share) = running.get_mut(&id) {
            share.name = name;
            share.panes.send_replace(req.panes);
            share.expires_at.send_replace(req.expires_at);
            return Ok(json!({"id": id, "key": key}));
        }
        let started = self.started.fetch_add(1, Ordering::Relaxed);
        let (panes_tx, panes) = watch::channel(req.panes);
        let (expires_tx, expires) = watch::channel(req.expires_at);
        let share = Running { key, name, panes: panes_tx, expires_at: expires_tx, started };
        let answer = json!({"id": id, "key": share.key});
        running.insert(id.clone(), share);
        drop(running);
        tokio::spawn(serve(Arc::clone(self), id, started, identity, panes, expires));
        Ok(answer)
    }

    /// The shares running, without their keys.
    pub fn list(&self) -> Value {
        let running = self.running.lock().expect("agent shares poisoned");
        let info = |(id, share): (&String, &Running)| {
            json!({
                "id": id,
                "name": share.name,
                "panes": *share.panes.borrow(),
                "expiresAt": *share.expires_at.borrow(),
            })
        };
        Value::Array(running.iter().map(info).collect())
    }

    /// The link's key of a share running. Never starts one.
    pub fn link(&self, p: Value) -> Result<Value, RpcError> {
        let id = id_of(p)?;
        let running = self.running.lock().expect("agent shares poisoned");
        let share = running.get(&id).ok_or_else(|| RpcError::new("not_found", "not shared"))?;
        Ok(json!({"id": id, "key": share.key}))
    }

    pub fn stop(&self, p: Value) -> Result<Value, RpcError> {
        let id = id_of(p)?;
        self.running.lock().expect("agent shares poisoned").remove(&id);
        Ok(Value::Null)
    }

    /// Forgets a share that ended, unless it is one started since with the same key.
    fn ended(&self, id: &str, started: u64) {
        let mut running = self.running.lock().expect("agent shares poisoned");
        if running.get(id).is_some_and(|share| share.started == started) {
            running.remove(id);
        }
    }
}

/// Serves a share's guests until it runs out, is stopped, or loses the relay for good.
async fn serve(
    shares: Arc<AgentShares>,
    id: String,
    started: u64,
    identity: Identity,
    panes: watch::Receiver<Vec<String>>,
    mut expires: watch::Receiver<u64>,
) {
    let (inbox, inbox_rx) = mpsc::unbounded_channel();
    let guests = Guests::new(
        Arc::clone(&shares.slot),
        panes.clone(),
        shares.records.clone(),
        shares.ice.clone(),
        inbox.clone(),
    );
    let _guests = AbortOnDrop(tokio::spawn(guests::run(guests, inbox_rx)));
    // The machine as its guests see it: no hostname.
    let machine = MachineInfo { hostname: String::new(), ..shares.machine.clone() };
    let (states_tx, states) = watch::channel(None);
    let derived = derive(shares.states.clone(), panes, machine.clone(), states_tx);
    let _derived = AbortOnDrop(tokio::spawn(derived));
    let relay = shares.relay.clone();
    let mut uplink = AbortOnDrop(tokio::spawn(async move {
        uplink::run(&relay, &identity, &machine, inbox, states).await.map_err(|e| e.to_string())
    }));

    let ending = loop {
        let left = expires.borrow_and_update().saturating_sub(now_ms());
        tokio::select! {
            ended = &mut uplink.0 => {
                tracing::warn!(?ended, "an agent share lost its relay connection");
                break "relay lost";
            }
            () = tokio::time::sleep(Duration::from_millis(left)) => break "expired",
            changed = expires.changed() => if changed.is_err() { break "stopped" },
        }
    };
    tracing::info!(id, ending, "agent share ended");
    shares.ended(&id, started);
}

/// Keeps the share's state made from this machine's and the panes shared, as either changes.
async fn derive(
    mut states: States,
    mut panes: watch::Receiver<Vec<String>>,
    machine: MachineInfo,
    out: watch::Sender<Option<MachineState>>,
) {
    let boot = now_ms();
    let mut rev = 0;
    loop {
        let next =
            guest_state(states.borrow_and_update().as_ref(), &panes.borrow_and_update(), &machine);
        let changed = out.borrow().as_ref().map(|s| (&s.herdr, &s.agents))
            != next.as_ref().map(|s| (&s.herdr, &s.agents));
        if changed {
            rev += 1;
            out.send_replace(next.map(|s| MachineState { boot, rev, ..s }));
        }
        tokio::select! {
            changed = states.changed() => if changed.is_err() { return },
            changed = panes.changed() => if changed.is_err() { return },
        }
    }
}

/// What a share's guests see of this machine: its agents in the panes shared, and the calls they
/// may make. `boot` and `rev` are the share's own, set by the caller.
fn guest_state(
    state: Option<&MachineState>,
    panes: &[String],
    machine: &MachineInfo,
) -> Option<MachineState> {
    let state = state?;
    let agents = state.agents.iter().filter(|a| panes.contains(&a.pane_id)).cloned().collect();
    Some(MachineState {
        machine: machine.clone(),
        boot: 0,
        rev: 0,
        herdr: state.herdr.clone(),
        caps: Caps { methods: guests::methods(), agent_kinds: Vec::new() },
        agents,
        shares: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use isbell_proto::state::{Agent, AgentStatus, HerdrState, HerdrStatus};

    use super::*;

    static SPACE: std::sync::LazyLock<Identity> = std::sync::LazyLock::new(Identity::generate);

    fn shares() -> Arc<AgentShares> {
        let machine = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "mac".into(),
            hostname: "mac.local".into(),
            os: "macos".into(),
            version: "0.9.2".into(),
        };
        let (_tx, states) = watch::channel(None);
        AgentShares::new(
            SPACE.sid(),
            String::new(),
            Vec::new(),
            machine,
            HerdrSlot::default(),
            states,
        )
    }

    fn put(name: &str, expires_at: u64, panes: &[&str]) -> Value {
        json!({"name": name, "expiresAt": expires_at, "panes": panes})
    }

    #[tokio::test]
    async fn checks_what_it_is_asked_to_share() {
        let shares = shares();
        let soon = now_ms() + 60 * 60 * 1000;
        let bad = |p: Value| shares.put(p).unwrap_err().code;
        assert_eq!(bad(put("", soon, &[])), "bad_request");
        assert_eq!(bad(put("a\nb", soon, &[])), "bad_request");
        assert_eq!(bad(put(&"x".repeat(65), soon, &[])), "bad_request");
        assert_eq!(bad(put("Li", now_ms(), &[])), "bad_request");
        assert_eq!(bad(put("Li", now_ms() + LONGEST + 60_000, &[])), "bad_request");
        assert_eq!(bad(put("Li", soon, &[""])), "bad_request");
        let mut with_key = put("Li", soon, &[]);
        with_key["key"] = json!("not a key");
        assert_eq!(bad(with_key.clone()), "bad_request");
        // The machine's own space is not a share.
        with_key["key"] = json!(SPACE.key_string());
        assert_eq!(bad(with_key), "bad_request");
    }

    #[tokio::test]
    async fn the_same_key_changes_the_share_running() {
        let shares = shares();
        let soon = now_ms() + 60 * 60 * 1000;
        let first = shares.put(put("Li", soon, &["w1:p1"])).unwrap();
        let mut again = put("Li 2", soon + 1000, &["w1:p1", "w1:p2"]);
        again["key"] = first["key"].clone();
        let second = shares.put(again).unwrap();
        assert_eq!(first, second);

        let list = shares.list();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["name"], "Li 2");
        assert_eq!(list[0]["panes"], json!(["w1:p1", "w1:p2"]));
        assert!(list[0].get("key").is_none(), "keys are never listed");
        assert_eq!(shares.link(json!({"id": first["id"]})).unwrap()["key"], first["key"]);

        shares.stop(json!({"id": first["id"]})).unwrap();
        assert_eq!(shares.list(), json!([]));
        assert_eq!(shares.link(json!({"id": first["id"]})).unwrap_err().code, "not_found");
    }

    #[test]
    fn guests_see_only_the_agents_shared() {
        let agent = |pane: &str| Agent {
            pane_id: pane.into(),
            name: None,
            kind: Some("claude".into()),
            status: AgentStatus::Idle,
            status_since: 1,
            cwd: Some("/w".into()),
            title: None,
        };
        let machine = shares().machine.clone();
        let state = MachineState {
            machine: machine.clone(),
            boot: 1,
            rev: 7,
            herdr: HerdrState { status: HerdrStatus::Ready, version: None, protocol: None },
            caps: Caps {
                methods: vec!["isbell.file.write".into()],
                agent_kinds: vec!["claude".into()],
            },
            agents: vec![agent("w1:p1"), agent("w1:p2")],
            shares: Vec::new(),
        };
        let shown = guest_state(Some(&state), &["w1:p2".into()], &machine).unwrap();
        assert_eq!(shown.agents, vec![agent("w1:p2")]);
        assert_eq!(shown.caps.methods, guests::methods());
        assert!(guest_state(None, &["w1:p2".into()], &machine).is_none());
    }
}
