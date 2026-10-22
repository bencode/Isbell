//! NDJSON stream: the current snapshot first, then presence and agent status changes.

use std::collections::HashMap;

use isbell_proto::state::{Agent, AgentStatus, MachineState};
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use super::Ctx;
use super::output::CliError;
use crate::client::SessionEvent;
use crate::now_ms;

pub async fn run(ctx: &Ctx) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let mut events = session.events();
    // Machine id → (name, agent pane id → status), to report transitions.
    let mut known: HashMap<String, (String, HashMap<String, AgentStatus>)> = HashMap::new();
    for (state, online) in session.machines() {
        emit(json!({"at": now_ms(), "machine": state.machine.name, "online": online}));
        for agent in &state.agents {
            emit(agent_line(&state, agent, None));
        }
        known.insert(
            state.machine.id.clone(),
            (state.machine.name.clone(), statuses(&state)),
        );
    }
    loop {
        match events.recv().await {
            Ok(SessionEvent::Presence { mid, online }) => {
                let name = known
                    .get(&mid)
                    .map_or(mid.as_str(), |(name, _)| name.as_str());
                emit(json!({"at": now_ms(), "machine": name, "online": online}));
            }
            Ok(SessionEvent::State(state)) => {
                let previous = known.get(&state.machine.id).map(|(_, s)| s);
                for agent in &state.agents {
                    let prev = previous.and_then(|s| s.get(&agent.pane_id)).copied();
                    if prev != Some(agent.status) {
                        emit(agent_line(&state, agent, prev));
                    }
                }
                known.insert(
                    state.machine.id.clone(),
                    (state.machine.name.clone(), statuses(&state)),
                );
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

fn statuses(state: &MachineState) -> HashMap<String, AgentStatus> {
    state
        .agents
        .iter()
        .map(|a| (a.pane_id.clone(), a.status))
        .collect()
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
