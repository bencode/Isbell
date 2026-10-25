//! The gateway's unary methods: allowlisted herdr methods passed through, starting an agent in a
//! workspace of its own, and reading an agent's history a page at a time. The allowlist guards
//! against accidental remote misuse; holders of the space key are trusted.

use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};

use super::herdr::{Herdr, HerdrError, REQUEST_TIMEOUT};
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
const START_TIMEOUT: Duration = Duration::from_secs(35);
const BUSY_RETRY_FOR: Duration = Duration::from_secs(10);
const READY_WAIT_FOR: Duration = Duration::from_secs(30);
const POLL_EVERY: Duration = Duration::from_millis(500);
const MAX_NAME: usize = 28;
const HISTORY_SOURCES: [&str; 2] = ["recent", "recent_unwrapped"];
/// How far back a history page may reach, within the 4 MiB herdr answer.
const MAX_LINES: usize = 20_000;
const MAX_COUNT: usize = 500;
/// A page stays well under the relay's 1 MiB message.
const MAX_PAGE_BYTES: usize = 512 << 10;

/// An allowlisted herdr method, called as is.
pub async fn passthrough(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    #[derive(Deserialize)]
    struct Passthrough {
        method: String,
        #[serde(default)]
        params: Value,
    }
    let call: Passthrough = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    if !ALLOWED.contains(&call.method.as_str()) {
        let msg = format!("{} is not allowed remotely", call.method);
        return Err(RpcError::new("method_not_allowed", msg));
    }
    if reads_history(&call.method, &call.params) {
        return Ok(herdr.read_history(&call.method, call.params).await?);
    }
    let timeout = timeout_for(&call.method, &call.params);
    Ok(herdr.request(&call.method, call.params, timeout).await?)
}

fn reads_history(method: &str, params: &Value) -> bool {
    matches!(method, "agent.read" | "pane.read")
        && params["source"].as_str().is_some_and(|source| HISTORY_SOURCES.contains(&source))
}

/// Waiting calls run as long as herdr's own `timeout_ms` (or indefinitely); others get a default.
fn timeout_for(method: &str, params: &Value) -> Option<Duration> {
    let waits = method == "agent.wait" || (method == "agent.prompt" && !params["wait"].is_null());
    (!waits).then_some(REQUEST_TIMEOUT)
}

#[derive(Deserialize)]
struct History {
    target: String,
    skip: usize,
    count: usize,
}

/// Up to `count` lines of the agent's history ending `skip` lines above its last, as the agent
/// wrote them, and whether earlier lines may remain. herdr only has it while the agent is idle or
/// done.
pub async fn history(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    let req: History = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    if !(1..=MAX_COUNT).contains(&req.count) {
        return Err(RpcError::new("bad_request", format!("count must be 1..={MAX_COUNT}")));
    }
    // A page stops at the furthest it may reach.
    let count = req.count.min(MAX_LINES.saturating_sub(req.skip));
    if count == 0 {
        return Ok(json!({"text": "", "more": false}));
    }
    let params =
        json!({"target": req.target, "source": "recent_unwrapped", "lines": req.skip + count});
    let read = herdr.read_history("agent.read", params).await?;
    let (text, more) = page(read["read"]["text"].as_str().unwrap_or_default(), req.skip, count);
    if text.len() > MAX_PAGE_BYTES {
        let msg = format!("the page is over {} KiB; ask for fewer lines", MAX_PAGE_BYTES >> 10);
        return Err(RpcError::new("history_page_too_large", msg));
    }
    Ok(json!({"text": text, "more": more}))
}

/// The page out of `text`, the last `skip + count` lines herdr has (fewer when that is all). A
/// read that stops inside the history can have the header an agent pins over its top line (Codex
/// shows the prompt of the turn in view), so a page short of the start leaves that line out.
fn page(text: &str, skip: usize, count: usize) -> (String, bool) {
    let lines: Vec<&str> = text.lines().collect();
    let reach = skip + count;
    let inside = lines.len() >= reach;
    let end = lines.len().saturating_sub(skip);
    let start = end.saturating_sub(count).max(usize::from(inside));
    (lines[start..end].join("\n"), inside && reach < MAX_LINES)
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
    let req: StartAgent = serde_json::from_value(p).map_err(RpcError::bad_request)?;
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
    herdr.request("agent.prompt", prompt, Some(REQUEST_TIMEOUT)).await?;
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
            herdr.request("agent.get", json!({"target": pane_id}), Some(REQUEST_TIMEOUT)).await?;
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
    let list = herdr.request("agent.list", json!({}), Some(REQUEST_TIMEOUT)).await?;
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
        assert_eq!(timeout_for("agent.prompt", &json!({})), Some(REQUEST_TIMEOUT));
        assert_eq!(timeout_for("agent.read", &json!({})), Some(REQUEST_TIMEOUT));
    }

    #[test]
    fn only_history_reads_take_turns() {
        assert!(reads_history("agent.read", &json!({"source": "recent_unwrapped"})));
        assert!(reads_history("pane.read", &json!({"source": "recent"})));
        assert!(!reads_history("agent.read", &json!({"source": "visible"})));
        assert!(!reads_history("agent.list", &json!({"source": "recent"})));
    }

    /// What herdr answers for the last `reach` of `total` lines: one that stops inside the
    /// history has a pinned header over its top line.
    fn herdr_read(total: usize, reach: usize) -> String {
        let first = total.saturating_sub(reach) + 1;
        let line =
            |n: usize| if n == first && reach < total { "pinned".into() } else { n.to_string() };
        (first..=total).map(|n| line(n) + "\n").collect()
    }

    #[test]
    fn pages_count_back_from_the_last_line() {
        assert_eq!(page(&herdr_read(10, 3), 0, 3), ("9\n10".into(), true));
        assert_eq!(page(&herdr_read(10, 7), 3, 4), ("5\n6\n7".into(), true));
        // herdr had fewer lines than asked for: this page reaches the start, top line and all.
        assert_eq!(page(&herdr_read(10, 12), 8, 4), ("1\n2".into(), false));
        assert_eq!(page(&herdr_read(10, 16), 12, 4), (String::new(), false));
        // The furthest a page may reach leaves no page beyond it.
        assert!(!page(&herdr_read(MAX_LINES + 5, MAX_LINES), MAX_LINES - 2, 2).1);
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
