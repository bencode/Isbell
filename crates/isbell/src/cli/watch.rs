//! NDJSON stream: the current snapshot first, then presence and agent status changes.

use std::collections::HashMap;

use isbell_proto::state::{Agent, AgentStatus, MachineState};
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use super::Ctx;
use super::output::CliError;
use crate::client::SessionEvent;
use crate::now_ms;

/// Machine id → (name, agent pane id → status), to report transitions.
type Known = HashMap<String, (String, HashMap<String, AgentStatus>)>;

pub async fn run(ctx: &Ctx) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let mut events = session.events();
    let machines = session.machines();
    for (state, online) in &machines {
        emit(json!({"at": now_ms(), "machine": state.machine.name, "online": online}));
        status_lines(state, None).into_iter().for_each(emit);
    }
    let mut known: Known = machines.iter().map(|(state, _)| known_entry(state)).collect();
    loop {
        match events.recv().await {
            Ok(SessionEvent::Presence { mid, online }) => {
                let name = known.get(&mid).map_or(mid.as_str(), |(name, _)| name.as_str());
                emit(json!({"at": now_ms(), "machine": name, "online": online}));
            }
            Ok(SessionEvent::State(state)) => {
                let previous = known.get(&state.machine.id).map(|(_, statuses)| statuses);
                status_lines(&state, previous).into_iter().for_each(emit);
                let (mid, entry) = known_entry(&state);
                known.insert(mid, entry);
            }
            Ok(SessionEvent::Closed) | Err(RecvError::Closed) => {
                return Err(CliError::new("disconnected", "lost the relay connection"));
            }
            Err(RecvError::Lagged(missed)) => {
                tracing::warn!(missed, "watch fell behind; some events were skipped")
            }
        }
    }
}

/// A line per agent whose status differs from `previous` (every agent of a machine not seen yet).
fn status_lines(
    state: &MachineState,
    previous: Option<&HashMap<String, AgentStatus>>,
) -> Vec<Value> {
    state
        .agents
        .iter()
        .filter_map(|agent| {
            let prev = previous.and_then(|s| s.get(&agent.pane_id)).copied();
            (prev != Some(agent.status)).then(|| agent_line(state, agent, prev))
        })
        .collect()
}

fn known_entry(state: &MachineState) -> (String, (String, HashMap<String, AgentStatus>)) {
    (state.machine.id.clone(), (state.machine.name.clone(), statuses(state)))
}

fn statuses(state: &MachineState) -> HashMap<String, AgentStatus> {
    state.agents.iter().map(|a| (a.pane_id.clone(), a.status)).collect()
}

fn agent_line(state: &MachineState, agent: &Agent, prev: Option<AgentStatus>) -> Value {
    json!({
        "at": now_ms(),
        "machine": state.machine.name,
        "agent": agent.label(),
        "status": agent.status,
        "prev": prev,
    })
}

fn emit(line: Value) {
    println!("{line}");
}
