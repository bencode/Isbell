//! Derives the reported `MachineState` from herdr's session snapshot.

use isbell_proto::state::MachineInfo;
use isbell_proto::state::{Agent, AgentStatus, Caps, HerdrState, MachineState};
use serde::Deserialize;
use serde_json::Value;

use crate::now_ms;

/// herdr agent kinds and the executable each launches (`cursor` and `kiro` differ from their kind).
const AGENT_KINDS: &[(&str, &str)] = &[
    ("pi", "pi"),
    ("claude", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("cursor", "cursor-agent"),
    ("devin", "devin"),
    ("agy", "agy"),
    ("cline", "cline"),
    ("omp", "omp"),
    ("mastracode", "mastracode"),
    ("opencode", "opencode"),
    ("copilot", "copilot"),
    ("kimi", "kimi"),
    ("kiro", "kiro-cli"),
    ("droid", "droid"),
    ("amp", "amp"),
    ("grok", "grok"),
    ("hermes", "hermes"),
    ("kilo", "kilo"),
    ("qodercli", "qodercli"),
    ("qwen", "qwen"),
    ("letta", "letta"),
    ("maki", "maki"),
    ("muse", "muse"),
];

/// The subset of herdr's `AgentInfo` the gateway reports.
#[derive(Debug, Deserialize)]
pub struct AgentInfo {
    pane_id: String,
    name: Option<String>,
    agent: Option<String>,
    display_agent: Option<String>,
    agent_status: AgentStatus,
    cwd: Option<String>,
    foreground_cwd: Option<String>,
    title: Option<String>,
}

/// Agents from a `session.snapshot` result.
pub fn snapshot_agents(result: &Value) -> Result<Vec<AgentInfo>, serde_json::Error> {
    Vec::deserialize(&result["snapshot"]["agents"])
}

/// `status_since` carries over from `prev` while an agent keeps its status.
pub fn derive_agents(infos: Vec<AgentInfo>, prev: &[Agent], now: u64) -> Vec<Agent> {
    infos
        .into_iter()
        .map(|info| {
            let status_since = prev
                .iter()
                .find(|a| a.pane_id == info.pane_id && a.status == info.agent_status)
                .map_or(now, |a| a.status_since);
            Agent {
                pane_id: info.pane_id,
                name: info.name,
                kind: info.display_agent.or(info.agent),
                status: info.agent_status,
                status_since,
                cwd: info.foreground_cwd.or(info.cwd),
                title: info.title,
            }
        })
        .collect()
}

/// Agent kinds whose executable is on this process's PATH.
pub fn agent_kinds() -> Vec<String> {
    let dirs: Vec<_> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    AGENT_KINDS
        .iter()
        .filter(|(_, exe)| dirs.iter().any(|d| d.join(exe).is_file()))
        .map(|(kind, _)| (*kind).to_owned())
        .collect()
}

/// Keeps the last reported state and bumps `rev` only on real changes.
pub struct StateTracker {
    machine: MachineInfo,
    caps: Caps,
    boot: u64,
    current: Option<MachineState>,
}

impl StateTracker {
    pub fn new(machine: MachineInfo, caps: Caps) -> Self {
        Self { machine, caps, boot: now_ms(), current: None }
    }

    pub fn agents(&self) -> &[Agent] {
        self.current.as_ref().map_or(&[], |s| &s.agents)
    }

    /// The new state when it differs from the last one.
    pub fn update(&mut self, herdr: HerdrState, agents: Vec<Agent>) -> Option<&MachineState> {
        let unchanged =
            self.current.as_ref().is_some_and(|s| s.herdr == herdr && s.agents == agents);
        if unchanged {
            return None;
        }
        let rev = self.current.as_ref().map_or(0, |s| s.rev + 1);
        self.current = Some(MachineState {
            machine: self.machine.clone(),
            boot: self.boot,
            rev,
            herdr,
            caps: self.caps.clone(),
            agents,
        });
        self.current.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::state::HerdrStatus;

    fn fixture() -> Vec<AgentInfo> {
        let result: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/snapshot.json")).unwrap();
        snapshot_agents(&result).unwrap()
    }

    #[test]
    fn derives_agents_with_fallbacks() {
        let agents = derive_agents(fixture(), &[], 100);
        let reviewer = agents.iter().find(|a| a.name.as_deref() == Some("reviewer")).unwrap();
        assert_eq!(reviewer.kind.as_deref(), Some("Claude Code"), "display_agent wins over agent");
        assert_eq!(
            reviewer.cwd.as_deref(),
            Some("/Users/dev/work/isbell/crates"),
            "foreground_cwd wins over cwd"
        );
        let unnamed = agents.iter().find(|a| a.name.is_none()).unwrap();
        assert_eq!(
            (unnamed.kind.as_deref(), unnamed.cwd.as_deref()),
            (Some("codex"), Some("/Users/dev/work/other"))
        );
        assert_eq!(unnamed.label(), unnamed.pane_id);
    }

    #[test]
    fn status_since_changes_only_with_status() {
        let first = derive_agents(fixture(), &[], 100);
        let same = derive_agents(fixture(), &first, 200);
        assert!(same.iter().all(|a| a.status_since == 100));
        let mut prev = first.clone();
        prev[0].status = AgentStatus::Unknown;
        let changed = derive_agents(fixture(), &prev, 300);
        assert_eq!(changed[0].status_since, 300);
        assert_eq!(changed[1].status_since, 100);
    }

    #[test]
    fn tracker_bumps_rev_only_on_change() {
        let machine = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "m".into(),
            hostname: "h".into(),
            os: "macos".into(),
            version: "0".into(),
        };
        let ready = || HerdrState { status: HerdrStatus::Ready, version: None, protocol: None };
        let mut tracker = StateTracker::new(machine, Caps::default());
        let agents = derive_agents(fixture(), &[], 1);
        assert_eq!(tracker.update(ready(), agents.clone()).map(|s| s.rev), Some(0));
        assert!(tracker.update(ready(), agents.clone()).is_none());
        assert_eq!(tracker.update(ready(), agents[..1].to_vec()).map(|s| s.rev), Some(1));
    }
}
