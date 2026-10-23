//! The gateway's unary methods: allowlisted herdr methods passed through, and starting an agent in
//! a workspace of its own. The allowlist guards against accidental remote misuse; holders of the
//! space key are trusted.

use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};

use super::herdr::{Herdr, HerdrError};
use super::workspace;

pub const ALLOWED: &[&str] = &[
    "agent.list",
    "agent.get",
    "agent.read",
    "agent.prompt",
    "agent.wait",
    "agent.send_keys",
    "agent.rename",
    "pane.close",
    "pane.read",
    "workspace.list",
    "session.snapshot",
];
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const START_TIMEOUT: Duration = Duration::from_secs(35);
const BUSY_RETRY_FOR: Duration = Duration::from_secs(10);
const READY_WAIT_FOR: Duration = Duration::from_secs(30);
const POLL_EVERY: Duration = Duration::from_millis(500);
const MAX_NAME: usize = 28;

fn bad_request(err: impl std::fmt::Display) -> RpcError {
    RpcError::new("bad_request", err.to_string())
}

/// An allowlisted herdr method, called as is.
pub async fn passthrough(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    #[derive(Deserialize)]
    struct Passthrough {
        method: String,
        #[serde(default)]
        params: Value,
    }
    let call: Passthrough = serde_json::from_value(p).map_err(bad_request)?;
    if !ALLOWED.contains(&call.method.as_str()) {
        let msg = format!("{} is not allowed remotely", call.method);
        return Err(RpcError::new("method_not_allowed", msg));
    }
    let timeout = timeout_for(&call.method, &call.params);
    Ok(herdr.request(&call.method, call.params, timeout).await?)
}

/// Waiting calls run as long as herdr's own `timeout_ms` (or indefinitely); others get a default.
fn timeout_for(method: &str, params: &Value) -> Option<Duration> {
    let waits = method == "agent.wait" || (method == "agent.prompt" && !params["wait"].is_null());
    (!waits).then_some(DEFAULT_TIMEOUT)
}

#[derive(Deserialize)]
struct StartAgent {
    cwd: String,
    kind: String,
    name: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    prompt: Option<String>,
}

/// workspace.create → agent.start (retrying while the shell is busy) → optional prompt once ready.
/// The agent runs once it started: a prompt that could not be sent comes back as `promptError`
/// beside it, not as the call's error, so the caller does not start it again.
pub async fn start_agent(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    let req: StartAgent = serde_json::from_value(p).map_err(bad_request)?;
    let cwd = workspace::resolve_cwd(&req.cwd)?;
    let name = match req.name {
        Some(name) => name,
        None => {
            let base = default_name(&req.kind, &workspace::dir_name(&cwd));
            first_free(&base, &agent_names(herdr).await?)
        }
    };
    let pane_id = workspace::create(herdr, &cwd, &name).await?;
    let args = agent_args(&req.kind, req.args);
    let start = json!({"name": name, "kind": req.kind, "pane_id": pane_id, "args": args, "timeout_ms": 30_000});
    if let Err(err) = start_retrying_busy(herdr, start).await {
        workspace::close_pane(herdr, &pane_id, "agent start").await;
        return Err(err.into());
    }
    let unsent = match req.prompt {
        Some(text) => prompt_when_ready(herdr, &pane_id, text).await.err(),
        None => None,
    };
    let mut started = json!({"name": name, "paneId": pane_id});
    if let Some(err) = unsent {
        started["promptError"] = json!(err);
    }
    Ok(started)
}

async fn prompt_when_ready(herdr: &Herdr, pane_id: &str, text: String) -> Result<(), RpcError> {
    wait_until_ready(herdr, pane_id).await?;
    let prompt = json!({"target": pane_id, "text": text});
    herdr.request("agent.prompt", prompt, Some(DEFAULT_TIMEOUT)).await?;
    Ok(())
}

/// Codex hooks only run inside the pane without its background daemon.
fn agent_args(kind: &str, args: Vec<String>) -> Vec<String> {
    let no_daemon = (kind == "codex").then(|| "--no-daemon".to_owned());
    no_daemon.into_iter().chain(args).collect()
}

async fn start_retrying_busy(herdr: &Herdr, params: Value) -> Result<Value, HerdrError> {
    let deadline = Instant::now() + BUSY_RETRY_FOR;
    loop {
        match herdr.request("agent.start", params.clone(), Some(START_TIMEOUT)).await {
            Err(err) if err.code == "agent_pane_busy" && Instant::now() < deadline => {
                tokio::time::sleep(POLL_EVERY).await;
            }
            result => return result,
        }
    }
}

async fn wait_until_ready(herdr: &Herdr, pane_id: &str) -> Result<(), RpcError> {
    let deadline = Instant::now() + READY_WAIT_FOR;
    while Instant::now() < deadline {
        let info =
            herdr.request("agent.get", json!({"target": pane_id}), Some(DEFAULT_TIMEOUT)).await?;
        let agent = &info["agent"];
        let settled = matches!(agent["agent_status"].as_str(), Some("idle" | "done"));
        if settled && agent["interactive_ready"] == true {
            return Ok(());
        }
        tokio::time::sleep(POLL_EVERY).await;
    }
    Err(RpcError::new("agent_not_ready", "agent started but did not become ready for the prompt"))
}

/// `{kind}-{dir}` reduced to herdr's name alphabet (`[a-z][a-z0-9_-]*`).
fn default_name(kind: &str, dir: &str) -> String {
    let raw = format!("{kind}-{dir}").to_ascii_lowercase();
    let words: Vec<&str> = raw
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty())
        .collect();
    let name: String = words.join("-").chars().take(MAX_NAME).collect();
    let name = name.trim_end_matches('-');
    if name.starts_with(|c: char| c.is_ascii_lowercase()) {
        name.to_owned()
    } else {
        format!("a-{name}")
    }
}

async fn agent_names(herdr: &Herdr) -> Result<Vec<String>, RpcError> {
    let list = herdr.request("agent.list", json!({}), Some(DEFAULT_TIMEOUT)).await?;
    let agents = list["agents"].as_array().into_iter().flatten();
    Ok(agents.filter_map(|a| a["name"].as_str()).map(str::to_owned).collect())
}

/// `base`, else the first `base-N` not taken.
fn first_free(base: &str, taken: &[String]) -> String {
    (1..)
        .map(|n| if n == 1 { base.to_owned() } else { format!("{base}-{n}") })
        .find(|candidate| !taken.contains(candidate))
        .expect("an unused suffix exists")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_names_fit_herdr_rules() {
        assert_eq!(default_name("claude", "Isbell"), "claude-isbell");
        assert_eq!(default_name("codex", "my repo.v2"), "codex-my-repo-v2");
        assert_eq!(default_name("claude", "a-really-long-directory-name-here").len(), MAX_NAME);
        assert_eq!(default_name("claude", "--Über__x--"), "claude-ber__x");
        assert_eq!(default_name("9", ""), "a-9");
        assert_eq!(
            default_name("claude", "abcdefghijklmnopqrst-uvw"),
            "claude-abcdefghijklmnopqrst"
        );
    }

    #[test]
    fn only_waiting_calls_skip_the_default_timeout() {
        assert_eq!(timeout_for("agent.wait", &json!({})), None);
        assert_eq!(timeout_for("agent.prompt", &json!({"wait": {}})), None);
        assert_eq!(timeout_for("agent.prompt", &json!({})), Some(DEFAULT_TIMEOUT));
        assert_eq!(timeout_for("agent.read", &json!({})), Some(DEFAULT_TIMEOUT));
    }

    #[test]
    fn picks_the_first_free_name() {
        let taken = ["claude-x".to_owned(), "claude-x-2".to_owned()];
        assert_eq!(first_free("claude-y", &taken), "claude-y");
        assert_eq!(first_free("claude-x", &taken), "claude-x-3");
    }

    #[test]
    fn codex_runs_without_its_daemon() {
        let args = || vec!["--model".to_owned(), "m".to_owned()];
        assert_eq!(agent_args("codex", args()), ["--no-daemon", "--model", "m"]);
        assert_eq!(agent_args("claude", args()), args());
    }
}
