//! File shares: a link that lets anyone read one file, and the files beside it under its project's
//! root, live from this machine until the share is stopped or runs out. Each share is a space of
//! its own, with a key made for it and a relay connection of its own, so a reader holds no
//! credential for the real space. Shares live in this process and end with it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, HerdrState, HerdrStatus, MachineInfo, MachineState, ShareInfo};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};

use super::calls::readers::{self, Readers};
use super::file::{absolute_path, scoped};
use super::{nudge, uplink};
use crate::{AbortOnDrop, now_ms};

const SHORTEST: u64 = 60 * 1000;
const LONGEST: u64 = 7 * 24 * 60 * 60 * 1000;

/// The shares running, by id.
pub struct Shares {
    running: Mutex<BTreeMap<String, Running>>,
    refresh: mpsc::Sender<()>,
    relay: String,
    ice: Vec<String>,
    version: String,
}

struct Running {
    key: String,
    /// The file, as it was asked for: what a page that shared it looks for.
    path: PathBuf,
    /// The file, relative to the root its readers read under.
    entry: String,
    /// When it ends, in milliseconds on this clock; changed to give it longer or shorter, dropped
    /// to end it now.
    expires_at: watch::Sender<u64>,
}

impl Running {
    fn answer(&self, id: &str) -> Value {
        let expires_at = *self.expires_at.borrow();
        json!({"id": id, "key": self.key, "entry": self.entry, "expiresAt": expires_at})
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartParams {
    path: String,
    /// What its readers may read under; by default the repository it is in, else its directory.
    root: Option<String>,
    lasts_ms: u64,
}

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

fn id_of(p: Value) -> Result<String, RpcError> {
    let IdParams { id } = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    Ok(id)
}

impl Shares {
    pub fn new(
        refresh: mpsc::Sender<()>,
        relay: String,
        ice: Vec<String>,
        version: String,
    ) -> Arc<Shares> {
        Arc::new(Shares { running: Mutex::default(), refresh, relay, ice, version })
    }

    /// What state reports: never the keys, which would reach the relay's cache.
    pub fn infos(&self) -> Vec<ShareInfo> {
        let running = self.running.lock().expect("shares poisoned");
        let info = |(id, share): (&String, &Running)| ShareInfo {
            id: id.clone(),
            path: share.path.to_string_lossy().into_owned(),
            expires_at: *share.expires_at.borrow(),
        };
        running.iter().map(info).collect()
    }

    /// Starts sharing a file for `lastsMs`; a file already shared keeps its link and lasts that
    /// long from now instead.
    pub async fn start(self: &Arc<Self>, p: Value) -> Result<Value, RpcError> {
        let req: StartParams = serde_json::from_value(p).map_err(RpcError::bad_request)?;
        if !(SHORTEST..=LONGEST).contains(&req.lasts_ms) {
            return Err(RpcError::bad_request("a share lasts from a minute to seven days"));
        }
        let path = absolute_path(&req.path)?;
        let root = match &req.root {
            Some(root) => absolute_path(root)?,
            None => root_of(&path),
        };
        let (root, path, entry) = tokio::task::spawn_blocking(move || {
            let entry = shareable(&root, &path)?;
            Ok::<_, RpcError>((root, path, entry))
        })
        .await
        .map_err(|err| RpcError::new("io_error", err.to_string()))??;
        let expires_at = now_ms() + req.lasts_ms;
        let mut running = self.running.lock().expect("shares poisoned");
        if let Some((id, share)) = running.iter().find(|(_, share)| share.path == path) {
            share.expires_at.send_replace(expires_at);
            let answer = share.answer(id);
            drop(running);
            nudge(&self.refresh);
            return Ok(answer);
        }
        let identity = Identity::generate();
        let id = hex(&rand::random::<[u8; 8]>());
        let (expires_tx, expires) = watch::channel(expires_at);
        let share = Running { key: identity.key_string(), path, entry, expires_at: expires_tx };
        let answer = share.answer(&id);
        running.insert(id.clone(), share);
        drop(running);
        tokio::spawn(serve(Arc::clone(self), id, root, identity, expires));
        nudge(&self.refresh);
        Ok(answer)
    }

    /// The link of a share running. Never starts one: a share that just ran out must not begin
    /// again because a panel was opened.
    pub fn link(&self, p: Value) -> Result<Value, RpcError> {
        let id = id_of(p)?;
        let running = self.running.lock().expect("shares poisoned");
        let share = running.get(&id).ok_or_else(|| RpcError::new("not_found", "not shared"))?;
        Ok(share.answer(&id))
    }

    pub fn stop(&self, p: Value) -> Result<Value, RpcError> {
        let id = id_of(p)?;
        self.running.lock().expect("shares poisoned").remove(&id);
        nudge(&self.refresh);
        Ok(Value::Null)
    }

    /// Forgets a share that ended; one stopped is gone already.
    fn ended(&self, id: &str) {
        self.running.lock().expect("shares poisoned").remove(id);
        nudge(&self.refresh);
    }
}

/// The repository `path` is in (a worktree's own, where its `.git` is a file), else its directory.
fn root_of(path: &Path) -> PathBuf {
    let dir = path.parent().unwrap_or(path);
    dir.ancestors().find(|dir| dir.join(".git").exists()).unwrap_or(dir).to_path_buf()
}

/// Where the file `path` is under `root`, if its readers could read it there.
fn shareable(root: &Path, path: &Path) -> Result<String, RpcError> {
    let outside =
        || RpcError::new("not_shareable", "only a file under the root, not hidden, can be shared");
    let real_root = root.canonicalize().map_err(|_| outside())?;
    let real = path.canonicalize().map_err(|_| outside())?;
    let entry =
        real.strip_prefix(&real_root).map_err(|_| outside())?.to_string_lossy().into_owned();
    let real = scoped(root, &entry).map_err(|_| outside())?;
    if !real.is_file() {
        return Err(outside());
    }
    Ok(entry)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Serves a share's readers until it runs out, is stopped, or loses the relay for good.
async fn serve(
    shares: Arc<Shares>,
    id: String,
    root: PathBuf,
    identity: Identity,
    mut expires: watch::Receiver<u64>,
) {
    let (inbox, inbox_rx) = mpsc::unbounded_channel();
    let readers = Readers::new(root, shares.ice.clone(), inbox.clone());
    let _readers = AbortOnDrop(tokio::spawn(readers::run(readers, inbox_rx)));
    let state = anonymous_state(&shares.version);
    let machine = state.machine.clone();
    let (_state, states) = watch::channel(Some(state));
    let relay = shares.relay.clone();
    let mut uplink = AbortOnDrop(tokio::spawn(async move {
        uplink::run(&relay, &identity, &machine, inbox, states).await.map_err(|e| e.to_string())
    }));

    let ending = loop {
        let left = expires.borrow_and_update().saturating_sub(now_ms());
        tokio::select! {
            ended = &mut uplink.0 => {
                tracing::warn!(?ended, "a share lost its relay connection");
                break "relay lost";
            }
            () = tokio::time::sleep(Duration::from_millis(left)) => break "expired",
            changed = expires.changed() => if changed.is_err() { break "stopped" },
        }
    };
    tracing::info!(id, ending, "share ended");
    shares.ended(&id);
}

/// Who a share's readers see: not this machine. Reported without herdr, so that a page does not
/// go on to ask for its panes.
fn anonymous_state(version: &str) -> MachineState {
    let machine = MachineInfo {
        id: hex(&rand::random::<[u8; 8]>()),
        name: "share".into(),
        hostname: String::new(),
        os: String::new(),
        version: version.to_owned(),
    };
    MachineState {
        machine,
        boot: now_ms(),
        rev: 0,
        herdr: HerdrState { status: HerdrStatus::Unavailable, version: None, protocol: None },
        caps: Caps { methods: readers::methods(), agent_kinds: Vec::new() },
        agents: Vec::new(),
        shares: Vec::new(),
    }
}
