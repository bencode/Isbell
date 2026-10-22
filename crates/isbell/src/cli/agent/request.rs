//! What each agent command asks of herdr on the target machine: the method, its params, and how
//! long to wait for the answer.

use std::time::Duration;

use clap::ValueEnum;
use isbell_proto::state::{Agent, MachineState};
use serde_json::{Map, Value, json};

use crate::cli::output::CliError;

/// Slightly above the gateway's 30s so its own timeout error arrives first.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);
/// The gateway's worst case: workspace 30s + busy retries 10s + start 35s + ready 30s + prompt 30s
/// = 135s, plus a margin so its own error arrives first.
pub const START_TIMEOUT: Duration = Duration::from_secs(150);
const WAIT_MARGIN: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, ValueEnum)]
pub enum Source {
    Visible,
    Recent,
    RecentUnwrapped,
}

impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Source::Visible => "visible",
            Source::Recent => "recent",
            Source::RecentUnwrapped => "recent_unwrapped",
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Status {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Idle => "idle",
            Status::Working => "working",
            Status::Blocked => "blocked",
            Status::Done => "done",
            Status::Unknown => "unknown",
        }
    }
}

/// A herdr method call, sent through the gateway's `herdr` passthrough.
pub struct HerdrRequest {
    pub method: &'static str,
    pub params: Value,
    pub timeout: Option<Duration>,
}

impl HerdrRequest {
    pub fn passthrough(&self) -> Value {
        json!({"method": self.method, "params": self.params})
    }
}

/// What to wait for: any of `until` (herdr's default when empty), for up to `timeout_ms` (herdr
/// waits indefinitely when unset).
pub struct WaitSpec {
    pub until: Vec<Status>,
    pub timeout_ms: Option<u64>,
}

impl WaitSpec {
    /// Only the keys that are set, so herdr applies its own defaults.
    fn fields(&self) -> Map<String, Value> {
        let statuses: Vec<&str> = self.until.iter().map(|s| s.as_str()).collect();
        let until = (!statuses.is_empty()).then(|| ("until".to_owned(), json!(statuses)));
        let timeout = self.timeout_ms.map(|ms| ("timeout_ms".to_owned(), json!(ms)));
        until.into_iter().chain(timeout).collect()
    }

    /// As long as herdr waits, plus a margin so its own answer arrives first.
    fn call_timeout(&self) -> Option<Duration> {
        self.timeout_ms.map(|ms| Duration::from_millis(ms) + WAIT_MARGIN)
    }
}

fn request(method: &'static str, params: Value, timeout: Option<Duration>) -> HerdrRequest {
    HerdrRequest { method, params, timeout }
}

pub fn read(agent: &str, source: Source, lines: Option<u32>, ansi: bool) -> HerdrRequest {
    let format = if ansi { "ansi" } else { "text" };
    let params = json!({
        "target": agent, "source": source.as_str(), "lines": lines,
        "format": format, "strip_ansi": !ansi,
    });
    request("agent.read", params, Some(CALL_TIMEOUT))
}

pub fn prompt(agent: &str, text: &str, wait: Option<WaitSpec>) -> HerdrRequest {
    match wait {
        None => request("agent.prompt", json!({"target": agent, "text": text}), Some(CALL_TIMEOUT)),
        Some(spec) => {
            let params = json!({"target": agent, "text": text, "wait": spec.fields()});
            request("agent.prompt", params, spec.call_timeout())
        }
    }
}

pub fn wait(agent: &str, spec: WaitSpec) -> HerdrRequest {
    let target = ("target".to_owned(), json!(agent));
    let params = [target].into_iter().chain(spec.fields()).collect();
    request("agent.wait", Value::Object(params), spec.call_timeout())
}

pub fn send_keys(agent: &str, keys: Vec<String>) -> HerdrRequest {
    request("agent.send_keys", json!({"target": agent, "keys": keys}), Some(CALL_TIMEOUT))
}

pub fn rename(agent: &str, name: Option<String>) -> HerdrRequest {
    request("agent.rename", json!({"target": agent, "name": name}), Some(CALL_TIMEOUT))
}

pub fn close(pane_id: &str) -> HerdrRequest {
    request("pane.close", json!({"pane_id": pane_id}), Some(CALL_TIMEOUT))
}

/// An agent of `state` by pane id or name.
pub fn find_agent<'s>(state: &'s MachineState, agent: &str) -> Result<&'s Agent, CliError> {
    let found =
        state.agents.iter().find(|a| a.pane_id == agent || a.name.as_deref() == Some(agent));
    found.ok_or_else(|| {
        let message = format!("no agent {agent:?} on {}", state.machine.name);
        CliError::new("agent_not_found", message)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_specs_carry_only_what_is_set() {
        let spec = |until: Vec<Status>, timeout_ms| WaitSpec { until, timeout_ms };
        assert_eq!(wait("a", spec(vec![], None)).params, json!({"target": "a"}));
        assert_eq!(wait("a", spec(vec![], None)).timeout, None, "waits as long as herdr does");
        let both = wait("a", spec(vec![Status::Idle, Status::Blocked], Some(5000)));
        assert_eq!(
            both.params,
            json!({"target": "a", "until": ["idle", "blocked"], "timeout_ms": 5000})
        );
        assert_eq!(both.timeout, Some(Duration::from_millis(5000) + WAIT_MARGIN));
    }

    #[test]
    fn prompts_wait_only_when_asked() {
        let quick = prompt("a", "hi", None);
        assert_eq!(
            (quick.params, quick.timeout),
            (json!({"target": "a", "text": "hi"}), Some(CALL_TIMEOUT))
        );
        let waiting = prompt("a", "hi", Some(WaitSpec { until: vec![], timeout_ms: None }));
        assert_eq!(
            (waiting.params, waiting.timeout),
            (json!({"target": "a", "text": "hi", "wait": {}}), None)
        );
    }

    #[test]
    fn reads_text_unless_ansi_is_kept() {
        let text = read("a", Source::RecentUnwrapped, Some(5), false).params;
        assert_eq!(
            text,
            json!({"target": "a", "source": "recent_unwrapped", "lines": 5, "format": "text", "strip_ansi": true})
        );
        let ansi = read("a", Source::Visible, None, true).params;
        assert_eq!((&ansi["format"], &ansi["strip_ansi"]), (&json!("ansi"), &json!(false)));
    }
}
