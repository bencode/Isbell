//! The agent sessions running now on this machine, from herdr: what Isbell's agent hook reports of
//! each pane (`isbell_agent`, `isbell_session`), else the session herdr's own integration made out
//! (`agent_session`), for an agent started where Isbell's hook is not installed.

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
            let agent = Agent::parse(a["agent"].as_str()?)?;
            let tokens = &a["tokens"];
            // What the hook left outlives its agent in the pane: it holds for the one that made it.
            // The hook's first version, for Claude Code alone, did not say which.
            let ours = tokens["isbell_agent"].as_str().unwrap_or("claude") == agent.as_str();
            let session = ours
                .then(|| tokens["isbell_session"].as_str())
                .flatten()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .or_else(|| herdr_session(&a["agent_session"], agent))?;
            Some(Live {
                agent,
                session,
                pane: a["pane_id"].as_str()?.to_owned(),
                name: a["name"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

/// The session herdr made out for the agent in the pane now: its id, or the file it is kept in,
/// named `<time>_<id>.jsonl` (pi's).
fn herdr_session(session: &Value, agent: Agent) -> Option<String> {
    if session["agent"].as_str()? != agent.as_str() {
        return None;
    }
    let value = session["value"].as_str().filter(|v| !v.is_empty())?;
    match session["kind"].as_str()? {
        "id" => Some(value.to_owned()),
        "path" => {
            let stem = std::path::Path::new(value).file_stem()?.to_str()?;
            stem.rsplit_once('_').map(|(_, id)| id.to_owned())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_counts_when_the_hook_reported_its_session() {
        let list = json!({"agents": [
            {"pane_id": "w1:p1", "agent": "pi", "name": "pi-yimi", "tokens": {"isbell_agent": "pi", "isbell_session": "01a1"}},
            {"pane_id": "w1:p2", "agent": "claude", "name": "claude-x", "tokens": {}},
        ]});
        let live = of_list(&list);
        assert_eq!(live.len(), 1);
        assert_eq!(
            (live[0].agent, live[0].session.as_str(), live[0].pane.as_str()),
            (Agent::Pi, "01a1", "w1:p1")
        );
    }

    #[test]
    fn without_the_hook_herdrs_own_session_counts() {
        let list = json!({"agents": [
            {"pane_id": "w1:p1", "agent": "claude", "tokens": null,
             "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "c1"}},
            {"pane_id": "w1:p2", "agent": "pi",
             "agent_session": {"agent": "pi", "kind": "path", "source": "herdr:pi",
                               "value": "/h/.pi/agent/sessions/--w--/2026-11-01T03-29-35-314Z_p2.jsonl"}},
            // A token left by the pi that ran there before, and nothing from herdr: not running.
            {"pane_id": "w1:p3", "agent": "codex", "tokens": {"isbell_agent": "pi", "isbell_session": "old"}},
        ]});
        let live: Vec<_> =
            of_list(&list).into_iter().map(|l| (l.agent, l.session, l.pane)).collect();
        assert_eq!(
            live,
            [
                (Agent::Claude, "c1".to_owned(), "w1:p1".to_owned()),
                (Agent::Pi, "p2".to_owned(), "w1:p2".to_owned()),
            ]
        );
    }
}
