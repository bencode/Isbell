//! Sends scheduled messages to running agents, by what `~/.isbell/loops.json` asks, with no browser
//! open. How each loop has gone is kept beside it in `loops-state.json`, for the browser to show.

mod schedule;

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
use isbell_proto::state::{Agent, HerdrStatus, MachineState};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::watch;

use self::schedule::{
    Loop, Outcome, Run, Runs, after, clear_command, clears, fires, ms, next_after, planned,
};
use super::herdr::{Herdr, HerdrError, REQUEST_TIMEOUT};
use super::{HerdrSlot, workspace};

const TICK: Duration = Duration::from_secs(10);
/// Long enough for an agent that works at clearing (codex takes some 3 s) to have shown it.
const CLEAR_SETTLE: Duration = Duration::from_secs(5);
const CLEAR_WAIT: Duration = Duration::from_secs(60);
const POLL_EVERY: Duration = Duration::from_secs(1);
const VERSION: u32 = 1;

type States = watch::Receiver<Option<MachineState>>;

struct Files {
    loops: PathBuf,
    runs: PathBuf,
}

impl Files {
    fn home() -> Option<Files> {
        Some(Files {
            loops: workspace::expand_home("~/.isbell/loops.json")?,
            runs: workspace::expand_home("~/.isbell/loops-state.json")?,
        })
    }
}

/// Runs for as long as the gateway does, sending what is due every tick.
pub async fn run(slot: HerdrSlot, states: States) {
    let Some(files) = Files::home() else {
        tracing::warn!("HOME is not set, so this machine runs no loops");
        return;
    };
    let mut runs = load_runs(&files.runs).await;
    let mut tick = tokio::time::interval(TICK);
    loop {
        tick.tick().await;
        runs = pass(&files, &slot, &states, runs).await;
    }
}

/// One tick: plans every loop, sends what is due in turn, and keeps how they went if that changed.
async fn pass(files: &Files, slot: &HerdrSlot, states: &States, runs: Runs) -> Runs {
    let Some(loops) = read_loops(&files.loops).await else { return runs };
    let now = Local::now();
    let mut next: Runs = loops
        .iter()
        .map(|l| (l.id.clone(), planned(l, runs.get(&l.id).cloned().unwrap_or_default(), &now)))
        .collect();
    if let Some((herdr, agents)) = live(slot, states) {
        for l in &loops {
            let Some(run) = next.get(&l.id).cloned() else { continue };
            if let Some(fired) = fire_if_due(&herdr, l, run, &agents, &now).await {
                next.insert(l.id.clone(), fired);
            }
        }
    }
    if next != runs {
        save_runs(&files.runs, &next).await;
    }
    next
}

/// Herdr and its agents, when it is there to be asked.
fn live(slot: &HerdrSlot, states: &States) -> Option<(Herdr, Vec<Agent>)> {
    let herdr = slot.read().expect("herdr slot poisoned").clone()?;
    let state = states.borrow();
    let state = state.as_ref().filter(|s| s.herdr.status == HerdrStatus::Ready)?;
    Some((herdr, state.agents.clone()))
}

/// The run after sending, if `l`'s agent is there and it was due. An agent gone leaves it as it is.
async fn fire_if_due(
    herdr: &Herdr,
    l: &Loop,
    run: Run,
    agents: &[Agent],
    now: &DateTime<Local>,
) -> Option<Run> {
    let agent = agents.iter().find(|a| a.pane_id == l.pane_id)?;
    let kind = agent.kind.as_deref()?;
    let at = ms(now);
    if !fires(&run, agent, at) {
        return None;
    }
    let clear = clears(l, &run);
    let outcome = fire(herdr, l, kind, clear).await;
    Some(after(run, outcome, clear, at, next_after(&l.schedule, now)))
}

/// Clears the context if asked, and only once that is done sends the message.
async fn fire(herdr: &Herdr, l: &Loop, kind: &str, clear: bool) -> Outcome {
    if clear {
        let Some(command) = clear_command(kind) else {
            tracing::error!(loop_id = %l.id, kind, "no way to clear this agent's context");
            return Outcome::ClearFailed;
        };
        if let Err(err) = clear_context(herdr, &l.pane_id, command).await {
            tracing::error!(loop_id = %l.id, %err, "could not clear the context");
            return Outcome::ClearFailed;
        }
    }
    match prompt(herdr, &l.pane_id, &l.message).await {
        Ok(()) => Outcome::Sent,
        Err(err) => {
            tracing::error!(loop_id = %l.id, %err, "could not send a loop's message");
            Outcome::SendFailed
        }
    }
}

async fn clear_context(herdr: &Herdr, pane_id: &str, command: &str) -> Result<(), HerdrError> {
    prompt(herdr, pane_id, command).await?;
    tokio::time::sleep(CLEAR_SETTLE).await;
    wait_stopped(herdr, pane_id).await
}

/// Types `text` into the agent and submits it: a message and a clear command alike.
async fn prompt(herdr: &Herdr, pane_id: &str, text: &str) -> Result<(), HerdrError> {
    let params = json!({"target": pane_id, "text": text});
    herdr.request("agent.prompt", params, Some(REQUEST_TIMEOUT)).await.map(|_| ())
}

async fn wait_stopped(herdr: &Herdr, pane_id: &str) -> Result<(), HerdrError> {
    let deadline = Instant::now() + CLEAR_WAIT;
    while Instant::now() < deadline {
        let params = json!({"target": pane_id});
        let info = herdr.request("agent.get", params, Some(REQUEST_TIMEOUT)).await?;
        if matches!(info["agent"]["agent_status"].as_str(), Some("idle" | "done")) {
            return Ok(());
        }
        tokio::time::sleep(POLL_EVERY).await;
    }
    Err(HerdrError {
        code: "agent_not_stopped".into(),
        message: "the agent did not stop after clearing".into(),
    })
}

#[derive(Deserialize)]
struct LoopsFile {
    version: u32,
    loops: Vec<Loop>,
}

/// The loops asked for: none without a file, and nothing to go by (`None`) in one that cannot be
/// read, so what is known of them is kept until it is put right.
async fn read_loops(path: &Path) -> Option<Vec<Loop>> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Some(Vec::new()),
        Err(err) => {
            tracing::error!(file = %path.display(), %err, "cannot read the loops");
            return None;
        }
    };
    match serde_json::from_slice::<LoopsFile>(&bytes) {
        Ok(file) if file.version == VERSION => Some(file.loops),
        Ok(file) => {
            tracing::error!(file = %path.display(), version = file.version, "unknown loops version");
            None
        }
        Err(err) => {
            tracing::error!(file = %path.display(), %err, "cannot parse the loops");
            None
        }
    }
}

/// What was kept; none from a file missing or unreadable, each loop then planned afresh.
async fn load_runs(path: &Path) -> Runs {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
            tracing::error!(file = %path.display(), %err, "ignoring unreadable loop state");
            Runs::new()
        }),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Runs::new(),
        Err(err) => {
            tracing::error!(file = %path.display(), %err, "cannot read the loop state");
            Runs::new()
        }
    }
}

/// Written aside and renamed over, so a reader never sees half a file.
async fn save_runs(path: &Path, runs: &Runs) {
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(runs).expect("loop state serializes");
    let saved = async {
        tokio::fs::write(&tmp, bytes).await?;
        tokio::fs::rename(&tmp, path).await
    };
    if let Err(err) = saved.await {
        tracing::error!(file = %path.display(), %err, "cannot keep the loop state");
    }
}
