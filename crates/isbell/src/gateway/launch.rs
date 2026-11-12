//! `isbell.agent.launch`: an agent started by a command of the user's own, such as a wrapper
//! (`reclaude`) or one that sets its environment first (`cc_glm && claude`), which herdr's
//! `agent.start` cannot run. The command is typed into a new workspace's shell, and the agent is
//! named once herdr recognizes it there. The pane's `ISBELL_LAUNCH` tells the agent hook the
//! command, so the session can be resumed by it.

use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};

use super::herdr::{Herdr, REQUEST_TIMEOUT};
use super::rpc::{agent_args, agent_names, default_name, first_free};
use super::workspace;

const RECOGNIZE_WAIT_FOR: Duration = Duration::from_secs(30);
const POLL_EVERY: Duration = Duration::from_millis(500);

#[derive(Deserialize)]
struct LaunchAgent {
    cwd: String,
    /// The agent herdr should recognize.
    kind: String,
    /// Run by the pane's shell as it is.
    command: String,
    /// Each one quoted after the command.
    #[serde(default)]
    args: Vec<String>,
    name: Option<String>,
}

/// workspace.create (with `ISBELL_LAUNCH`) → the command typed into its shell → named once herdr
/// recognizes the agent. One it does not recognize within the wait is no error: the pane stays,
/// a shell showing what the command said, and comes back with `recognized: false`.
pub async fn launch_agent(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    let req: LaunchAgent = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let line = launch_line(&req.command, &req.kind, req.args)?;
    let cwd = workspace::resolve_cwd(&req.cwd)?;
    let name = match req.name {
        Some(name) => name,
        None => {
            let base = default_name(&req.kind, &workspace::dir_name(&cwd));
            first_free(&base, &agent_names(herdr).await?)
        }
    };
    let env = json!({"ISBELL_LAUNCH": req.command.trim()});
    let pane_id = workspace::create(herdr, &cwd, &name, env).await?;
    let input = json!({"pane_id": pane_id, "text": line, "keys": ["enter"]});
    if let Err(err) = herdr.request("pane.send_input", input, Some(REQUEST_TIMEOUT)).await {
        workspace::close_pane(herdr, &pane_id, "agent launch").await;
        return Err(err.into());
    }
    let recognized = wait_recognized(herdr, &pane_id, &req.kind).await?;
    if recognized {
        let rename = json!({"target": pane_id, "name": name});
        if let Err(err) = herdr.request("agent.rename", rename, Some(REQUEST_TIMEOUT)).await {
            tracing::warn!(%err, pane = %pane_id, "cannot name the launched agent");
        }
    }
    Ok(json!({"name": name, "paneId": pane_id, "recognized": recognized}))
}

/// The command, then the agent's arguments quoted for the shell; one line, as typed.
fn launch_line(command: &str, kind: &str, args: Vec<String>) -> Result<String, RpcError> {
    let command = command.trim();
    if command.is_empty() || command.chars().any(char::is_control) {
        return Err(RpcError::new("bad_request", "the command must be one non-empty line"));
    }
    let words: Vec<String> = agent_args(kind, args).iter().map(|a| shell_word(a)).collect();
    Ok(std::iter::once(command.to_owned()).chain(words).collect::<Vec<_>>().join(" "))
}

/// `word` as the shell reads one word: as is when it needs no quoting, else single-quoted.
fn shell_word(word: &str) -> String {
    let plain = |c: char| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c);
    if !word.is_empty() && word.chars().all(plain) {
        word.to_owned()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

async fn wait_recognized(herdr: &Herdr, pane_id: &str, kind: &str) -> Result<bool, RpcError> {
    let deadline = Instant::now() + RECOGNIZE_WAIT_FOR;
    loop {
        let info =
            herdr.request("pane.get", json!({"pane_id": pane_id}), Some(REQUEST_TIMEOUT)).await?;
        if info["pane"]["agent"] == kind {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(POLL_EVERY).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_the_command_then_quoted_arguments() {
        let line = |command: &str, kind: &str, args: &[&str]| {
            launch_line(command, kind, args.iter().map(|a| a.to_string()).collect())
        };
        assert_eq!(line(" reclaude ", "claude", &[]).unwrap(), "reclaude");
        assert_eq!(
            line("cc_glm && claude", "claude", &["--resume", "a-1"]).unwrap(),
            "cc_glm && claude --resume a-1"
        );
        assert_eq!(
            line("codex", "codex", &["resume", "it's a test", ""]).unwrap(),
            r"codex --no-daemon resume 'it'\''s a test' ''"
        );
        assert_eq!(line("  ", "claude", &[]).unwrap_err().code, "bad_request");
        assert_eq!(line("claude\nrm -rf x", "claude", &[]).unwrap_err().code, "bad_request");
    }
}
