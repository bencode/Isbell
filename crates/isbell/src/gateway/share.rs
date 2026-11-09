//! Terminal shares: a link that lets anyone watch one pane, live, until it is stopped or runs out.
//! Each share is a space of its own, with a key made for it and a relay connection of its own, so
//! a viewer holds no credential for the real space. Shares live in this process and end with it.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, HerdrState, HerdrStatus, MachineInfo, MachineState, ShareInfo};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, watch};

use super::calls::Streams;
use super::calls::watch::{self as viewers, Screen, Viewers};
use super::herdr::{Herdr, HerdrError, REQUEST_TIMEOUT};
use super::{HerdrSlot, nudge, uplink};
use crate::{AbortOnDrop, now_ms};

const LASTS: Duration = Duration::from_secs(2 * 60 * 60);
const CHECK_EVERY: Duration = Duration::from_secs(3);
/// How long the viewers' last frames get to leave before the connection closes.
const FLUSH_WITHIN: Duration = Duration::from_secs(1);
#[cfg(target_os = "linux")]
const STTY_DEVICE: &str = "-F";
#[cfg(not(target_os = "linux"))]
const STTY_DEVICE: &str = "-f";

/// The shares running, by pane.
pub struct Shares {
    running: Mutex<BTreeMap<String, Running>>,
    slot: HerdrSlot,
    refresh: mpsc::Sender<()>,
    relay: String,
    ice: Vec<String>,
    version: String,
}

struct Running {
    key: String,
    expires_at: u64,
    streams: Streams,
    /// Dropping it ends the share.
    _stop: oneshot::Sender<()>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Params {
    pane_id: String,
}

fn pane_of(p: Value) -> Result<String, RpcError> {
    let Params { pane_id } = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    Ok(pane_id)
}

impl Shares {
    pub fn new(
        slot: HerdrSlot,
        refresh: mpsc::Sender<()>,
        relay: String,
        ice: Vec<String>,
        version: String,
    ) -> Arc<Shares> {
        Arc::new(Shares { running: Mutex::default(), slot, refresh, relay, ice, version })
    }

    /// What state reports: never the keys, which would reach the relay's cache.
    pub fn infos(&self) -> Vec<ShareInfo> {
        let running = self.running.lock().expect("shares poisoned");
        let info = |(pane_id, share): (&String, &Running)| ShareInfo {
            pane_id: pane_id.clone(),
            expires_at: share.expires_at,
            viewers: u32::try_from(share.streams.lock().expect("streams poisoned").len())
                .expect("few viewers"),
        };
        running.iter().map(info).collect()
    }

    /// Starts sharing a pane, or answers with the share it already has.
    pub async fn start(self: &Arc<Self>, p: Value) -> Result<Value, RpcError> {
        let pane = pane_of(p)?;
        let herdr = self.herdr().ok_or_else(unavailable)?;
        let size = pane_size(&herdr, &pane).await?;
        let mut running = self.running.lock().expect("shares poisoned");
        if let Some(share) = running.get(&pane) {
            return Ok(json!({"key": share.key, "expiresAt": share.expires_at}));
        }
        let identity = Identity::generate();
        let key = identity.key_string();
        let expires_at = now_ms() + u64::try_from(LASTS.as_millis()).expect("two hours fit");
        let (stop, stopped) = oneshot::channel();
        let streams = Streams::default();
        let share = Running { key: key.clone(), expires_at, streams: streams.clone(), _stop: stop };
        running.insert(pane.clone(), share);
        drop(running);
        let serving = Serving { pane, identity, size, streams, stopped };
        tokio::spawn(serve(Arc::clone(self), serving));
        nudge(&self.refresh);
        Ok(json!({"key": key, "expiresAt": expires_at}))
    }

    /// The key of the share running on a pane. Never starts one: a share that just ran out must
    /// not begin again because a popover was opened.
    pub fn link(&self, p: Value) -> Result<Value, RpcError> {
        let pane = pane_of(p)?;
        let running = self.running.lock().expect("shares poisoned");
        let share = running.get(&pane).ok_or_else(|| RpcError::new("not_found", "not shared"))?;
        Ok(json!({"key": share.key, "expiresAt": share.expires_at}))
    }

    pub fn stop(&self, p: Value) -> Result<Value, RpcError> {
        let pane = pane_of(p)?;
        self.running.lock().expect("shares poisoned").remove(&pane);
        nudge(&self.refresh);
        Ok(Value::Null)
    }

    fn herdr(&self) -> Option<Herdr> {
        self.slot.read().expect("herdr slot poisoned").clone()
    }

    /// Forgets a share that ended by itself; one stopped is gone already, and another may have
    /// taken its pane since.
    fn ended(&self, pane: &str, key: &str) {
        let mut running = self.running.lock().expect("shares poisoned");
        if running.get(pane).is_some_and(|share| share.key == key) {
            running.remove(pane);
        }
        drop(running);
        nudge(&self.refresh);
    }

    fn viewers(&self, pane: &str) -> usize {
        let running = self.running.lock().expect("shares poisoned");
        running.get(pane).map_or(0, |s| s.streams.lock().expect("streams poisoned").len())
    }
}

fn unavailable() -> RpcError {
    HerdrError::unavailable("herdr server is not available").into()
}

struct Serving {
    pane: String,
    identity: Identity,
    size: (u16, u16),
    streams: Streams,
    stopped: oneshot::Receiver<()>,
}

/// Serves a share's viewers until it ends for any reason, then tells them.
async fn serve(shares: Arc<Shares>, serving: Serving) {
    let Serving { pane, identity, size, streams, mut stopped } = serving;
    let key = identity.key_string();
    let (inbox, inbox_rx) = mpsc::unbounded_channel();
    let (screen, seen) = watch::channel::<Screen>(Some(size));
    let viewers = Viewers::new(
        streams,
        Arc::clone(&shares.slot),
        pane.clone(),
        seen,
        shares.ice.clone(),
        inbox.clone(),
    );
    let _viewers = AbortOnDrop(tokio::spawn(viewers::run(viewers, inbox_rx)));
    let machine = anonymous_machine(&shares.version);
    let (_state, states) = watch::channel(Some(anonymous_state(&machine)));
    let relay = shares.relay.clone();
    let mut uplink = AbortOnDrop(tokio::spawn(async move {
        uplink::run(&relay, &identity, &machine, inbox, states).await.map_err(|e| e.to_string())
    }));

    let expiry = tokio::time::sleep(LASTS);
    tokio::pin!(expiry);
    let mut check = tokio::time::interval(CHECK_EVERY);
    let mut counted = 0;
    let why = loop {
        tokio::select! {
            ended = &mut uplink.0 => {
                tracing::warn!(?ended, "a share lost its relay connection");
                break "relay";
            }
            () = &mut expiry => break "expired",
            _ = &mut stopped => break "stopped",
            _ = check.tick() => {
                if let Some(herdr) = shares.herdr() {
                    match pane_size(&herdr, &pane).await {
                        Ok(now) => {
                            screen.send_if_modified(|shown| {
                                let changed = *shown != Some(now);
                                *shown = Some(now);
                                changed
                            });
                        }
                        Err(err) if err.code == "pane_not_found" => break "pane closed",
                        Err(err) => tracing::warn!(code = err.code, msg = err.msg, "cannot check a shared pane"),
                    }
                }
                let viewing = shares.viewers(&pane);
                if viewing != counted {
                    counted = viewing;
                    nudge(&shares.refresh);
                }
            }
        }
    };
    tracing::info!(pane, why, "share ended");
    screen.send_replace(None);
    // With the connection gone there is nothing to wait for, and its task must not be polled again.
    if why != "relay"
        && let Ok(Ok(Err(err))) = tokio::time::timeout(FLUSH_WITHIN, &mut uplink.0).await
    {
        tracing::debug!(%err, "a share's relay connection failed as it ended");
    }
    shares.ended(&pane, &key);
}

/// Who a share's viewers see: not this machine. Reported without herdr, so that a page does not
/// go on to ask for its panes.
fn anonymous_machine(version: &str) -> MachineInfo {
    let id: [u8; 8] = rand::random();
    MachineInfo {
        id: id.iter().map(|b| format!("{b:02x}")).collect(),
        name: "share".into(),
        hostname: String::new(),
        os: String::new(),
        version: version.to_owned(),
    }
}

fn anonymous_state(machine: &MachineInfo) -> MachineState {
    MachineState {
        machine: machine.clone(),
        boot: now_ms(),
        rev: 0,
        herdr: HerdrState { status: HerdrStatus::Unavailable, version: None, protocol: None },
        caps: Caps { methods: viewers::methods(), agent_kinds: Vec::new() },
        agents: Vec::new(),
        shares: Vec::new(),
    }
}

/// The pane's real size, from its tty: herdr's layout does not follow whichever client last sized
/// the pane, and an observer shown at any other size sees it cut off or surrounded by blanks.
async fn pane_size(herdr: &Herdr, pane: &str) -> Result<(u16, u16), RpcError> {
    let info = herdr
        .request("pane.process_info", json!({ "pane_id": pane }), Some(REQUEST_TIMEOUT))
        .await?;
    let pid = info.pointer("/process_info/shell_pid").and_then(Value::as_u64);
    let pid = pid.ok_or_else(|| failed("herdr names no process for the pane"))?;
    let tty = output("/bin/ps", &["-o", "tty=", "-p", &pid.to_string()]).await?;
    let device = format!("/dev/{}", tty.trim());
    let size = output("/bin/stty", &[STTY_DEVICE, &device, "size"]).await?;
    parse_size(&size).ok_or_else(|| failed("the pane's tty reports no size"))
}

async fn output(program: &str, args: &[&str]) -> Result<String, RpcError> {
    let out = Command::new(program).args(args).output().await;
    let out = out.map_err(|err| failed(format!("cannot run {program}: {err}")))?;
    if !out.status.success() {
        return Err(failed(format!("{program} failed")));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `stty size` prints `rows cols`.
fn parse_size(output: &str) -> Option<(u16, u16)> {
    let (rows, cols) = output.trim().split_once(' ')?;
    let (rows, cols) = (rows.parse().ok()?, cols.parse().ok()?);
    (rows > 0 && cols > 0).then_some((cols, rows))
}

fn failed(msg: impl Into<String>) -> RpcError {
    RpcError::new("share_failed", msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stty_reads_rows_before_columns() {
        assert_eq!(parse_size("30 90\n"), Some((90, 30)));
        assert_eq!(parse_size("0 0\n"), None, "a tty nothing has sized yet");
    }
}
