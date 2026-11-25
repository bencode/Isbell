//! The agent sessions running now on this machine, from herdr: what the agent hook reports of
//! each pane (`isbell_agent`, `isbell_session`).

use serde_json::{Value, json};

use super::caller::Agent;
use super::roles::Live;
use crate::env_path;
use crate::gateway::herdr::{Herdr, REQUEST_TIMEOUT};

/// The sessions herdr runs, by the socket of the pane the command runs in (or
/// `$ISBELL_HERDR_SOCKET`). Outside herdr, or with herdr not answering, none: said on stderr, as
/// sessions there cannot be told running.
pub async fn sessions() -> Vec<Live> {
    let Some(socket) = env_path("HERDR_SOCKET_PATH").or_else(|| env_path("ISBELL_HERDR_SOCKET"))
    else {
        tracing::warn!("not in a herdr pane: no agent session is known to run");
        return Vec::new();
    };
    match Herdr::new(socket).request("agent.list", json!({}), Some(REQUEST_TIMEOUT)).await {
        Ok(list) => of_list(&list),
        Err(err) => {
            tracing::warn!(code = %err.code, message = %err.message, "herdr did not list its agents");
            Vec::new()
        }
    }
}

fn of_list(list: &Value) -> Vec<Live> {
    let agents = list["agents"].as_array().into_iter().flatten();
    agents
        .filter_map(|a| {
            let tokens = &a["tokens"];
            Some(Live {
                agent: Agent::parse(tokens["isbell_agent"].as_str()?)?,
                session: tokens["isbell_session"].as_str()?.to_owned(),
                pane: a["pane_id"].as_str()?.to_owned(),
                name: a["name"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_counts_when_the_hook_reported_its_session() {
        let list = json!({"agents": [
            {"pane_id": "w1:p1", "name": "pi-yimi", "tokens": {"isbell_agent": "pi", "isbell_session": "01a1"}},
            {"pane_id": "w1:p2", "name": "claude-x", "tokens": {}},
        ]});
        let live = of_list(&list);
        assert_eq!(live.len(), 1);
        assert_eq!(
            (live[0].agent, live[0].session.as_str(), live[0].pane.as_str()),
            (Agent::Pi, "01a1", "w1:p1")
        );
    }
}
