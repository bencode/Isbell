//! Requests the gateway serves: allowlisted herdr methods and `isbell.*` compositions.
//! The allowlist guards against accidental remote misuse; holders of the space key are trusted.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};

use super::herdr::{Herdr, HerdrError};

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
pub const START_AGENT: &str = "isbell.agent.start";

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const START_TIMEOUT: Duration = Duration::from_secs(35);
const BUSY_RETRY_FOR: Duration = Duration::from_secs(10);
const READY_WAIT_FOR: Duration = Duration::from_secs(30);
const POLL_EVERY: Duration = Duration::from_millis(500);
const MAX_NAME: usize = 28;

pub fn methods() -> Vec<String> {
    ALLOWED
        .iter()
        .chain([&START_AGENT])
        .map(|m| (*m).to_owned())
        .collect()
}

impl From<HerdrError> for RpcError {
    fn from(err: HerdrError) -> Self {
        RpcError {
            code: err.code,
            msg: err.message,
        }
    }
}

fn bad_request(err: impl std::fmt::Display) -> RpcError {
    RpcError::new("bad_request", err.to_string())
}

pub async fn handle(herdr: Option<Herdr>, m: &str, p: Value) -> Result<Value, RpcError> {
    let herdr =
        herdr.ok_or_else(|| RpcError::new("herdr_unavailable", "herdr server is not available"))?;
    match m {
        "herdr" => {
            #[derive(Deserialize)]
            struct Passthrough {
                method: String,
                #[serde(default)]
                params: Value,
            }
            let call: Passthrough = serde_json::from_value(p).map_err(bad_request)?;
            if !ALLOWED.contains(&call.method.as_str()) {
                return Err(RpcError::new(
                    "method_not_allowed",
                    format!("{} is not allowed remotely", call.method),
                ));
            }
            Ok(herdr
                .request(
                    &call.method,
                    call.params.clone(),
                    timeout_for(&call.method, &call.params),
                )
                .await?)
        }
        START_AGENT => start_agent(&herdr, serde_json::from_value(p).map_err(bad_request)?).await,
        _ => Err(RpcError::new(
            "method_not_allowed",
            format!("unknown method {m}"),
        )),
    }
}

/// Waiting calls run as long as herdr's own `timeout_ms` (or indefinitely); others get a default.
fn timeout_for(method: &str, params: &Value) -> Option<Duration> {
    let waits = method == "agent.wait" || (method == "agent.prompt" && !params["wait"].is_null());
    (!waits).then_some(DEFAULT_TIMEOUT)
}

#[derive(Deserialize)]
pub struct StartAgent {
    cwd: String,
    kind: String,
    name: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    prompt: Option<String>,
}

/// workspace.create → agent.start (retrying while the shell is busy) → optional prompt once ready.
async fn start_agent(herdr: &Herdr, req: StartAgent) -> Result<Value, RpcError> {
    let cwd = expand_home(&req.cwd)
        .filter(|p| p.is_absolute() && p.is_dir())
        .ok_or_else(|| {
            RpcError::new(
                "invalid_cwd",
                format!("{} is not an existing absolute directory", req.cwd),
            )
        })?;
    let name = match req.name {
        Some(name) => name,
        None => {
            let base = cwd
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            unique_name(herdr, &default_name(&req.kind, &base)).await?
        }
    };
    let created = herdr
        .request(
            "workspace.create",
            json!({"cwd": cwd, "label": name, "focus": false, "env": {}}),
            Some(DEFAULT_TIMEOUT),
        )
        .await?;
    let pane_id = created["root_pane"]["pane_id"]
        .as_str()
        .ok_or_else(|| RpcError::new("herdr_error", "workspace.create returned no root pane"))?
        .to_owned();

    let mut args = req.args;
    if req.kind == "codex" {
        // Codex hooks only run inside the pane without its background daemon.
        args.insert(0, "--no-daemon".into());
    }
    let start = json!({"name": name, "kind": req.kind, "pane_id": pane_id, "args": args, "timeout_ms": 30_000});
    if let Err(err) = start_retrying_busy(herdr, start).await {
        if let Err(close_err) = herdr
            .request(
                "pane.close",
                json!({"pane_id": pane_id}),
                Some(DEFAULT_TIMEOUT),
            )
            .await
        {
            tracing::warn!(%close_err, pane_id, "cannot close pane after failed agent start");
        }
        return Err(err.into());
    }
    if let Some(text) = req.prompt {
        wait_until_ready(herdr, &pane_id).await?;
        herdr
            .request(
                "agent.prompt",
                json!({"target": pane_id, "text": text}),
                Some(DEFAULT_TIMEOUT),
            )
            .await?;
    }
    Ok(json!({"name": name, "paneId": pane_id}))
}

async fn start_retrying_busy(herdr: &Herdr, params: Value) -> Result<Value, HerdrError> {
    let deadline = Instant::now() + BUSY_RETRY_FOR;
    loop {
        match herdr
            .request("agent.start", params.clone(), Some(START_TIMEOUT))
            .await
        {
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
        let info = herdr
            .request(
                "agent.get",
                json!({"target": pane_id}),
                Some(DEFAULT_TIMEOUT),
            )
            .await?;
        let agent = &info["agent"];
        let settled = matches!(agent["agent_status"].as_str(), Some("idle" | "done"));
        if settled && agent["interactive_ready"] == true {
            return Ok(());
        }
        tokio::time::sleep(POLL_EVERY).await;
    }
    Err(RpcError::new(
        "agent_not_ready",
        "agent started but did not become ready for the prompt",
    ))
}

fn expand_home(path: &str) -> Option<PathBuf> {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    match path.strip_prefix('~') {
        Some("") => home(),
        Some(rest) => rest
            .strip_prefix('/')
            .and_then(|rest| home().map(|h| h.join(rest))),
        None => Some(PathBuf::from(path)),
    }
}

/// `{kind}-{dir}` reduced to herdr's name alphabet (`[a-z][a-z0-9_-]*`).
fn default_name(kind: &str, dir: &str) -> String {
    let raw = format!("{kind}-{dir}").to_ascii_lowercase();
    let mut name = String::new();
    for c in raw.chars() {
        let c = if c.is_ascii_alphanumeric() || c == '_' {
            c
        } else {
            '-'
        };
        if !(c == '-' && name.ends_with('-')) {
            name.push(c);
        }
    }
    name.truncate(MAX_NAME);
    let name = name.trim_matches('-').to_owned();
    if name.starts_with(|c: char| c.is_ascii_lowercase()) {
        name
    } else {
        format!("a-{name}")
    }
}

async fn unique_name(herdr: &Herdr, base: &str) -> Result<String, RpcError> {
    let list = herdr
        .request("agent.list", json!({}), Some(DEFAULT_TIMEOUT))
        .await?;
    let taken: Vec<&str> = list["agents"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["name"].as_str())
        .collect();
    let name = (1..)
        .map(|n| {
            if n == 1 {
                base.to_owned()
            } else {
                format!("{base}-{n}")
            }
        })
        .find(|candidate| !taken.contains(&candidate.as_str()))
        .expect("an unused suffix exists");
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_names_fit_herdr_rules() {
        assert_eq!(default_name("claude", "Isbell"), "claude-isbell");
        assert_eq!(default_name("codex", "my repo.v2"), "codex-my-repo-v2");
        assert_eq!(
            default_name("claude", "a-really-long-directory-name-here").len(),
            MAX_NAME
        );
    }

    #[test]
    fn only_waiting_calls_skip_the_default_timeout() {
        assert_eq!(timeout_for("agent.wait", &json!({})), None);
        assert_eq!(timeout_for("agent.prompt", &json!({"wait": {}})), None);
        assert_eq!(
            timeout_for("agent.prompt", &json!({})),
            Some(DEFAULT_TIMEOUT)
        );
        assert_eq!(timeout_for("agent.read", &json!({})), Some(DEFAULT_TIMEOUT));
    }
}
