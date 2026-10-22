//! The reported `MachineState`, derived from herdr's session snapshot.

use std::ffi::OsStr;
use std::path::PathBuf;

use isbell_proto::state::{Agent, AgentStatus, Caps, HerdrState, MachineInfo, MachineState};
use serde::Deserialize;
use serde_json::Value;

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

/// Agent kinds whose executable is on `path` (a PATH-style list).
pub fn agent_kinds(path: Option<&OsStr>) -> Vec<String> {
    let dirs: Vec<PathBuf> = path.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    AGENT_KINDS
        .iter()
        .filter(|(_, exe)| dirs.iter().any(|d| d.join(exe).is_file()))
        .map(|(kind, _)| (*kind).to_owned())
        .collect()
}

/// What the gateway reports about itself besides herdr's state; fixed for the process.
pub struct Reporter {
    pub machine: MachineInfo,
    pub caps: Caps,
    pub boot: u64,
}

/// The state to report after `prev`, or `None` when nothing changed; `rev` counts the changes.
pub fn next_state(
    reporter: &Reporter,
    prev: Option<&MachineState>,
    herdr: HerdrState,
    agents: Vec<Agent>,
) -> Option<MachineState> {
    if prev.is_some_and(|s| s.herdr == herdr && s.agents == agents) {
        return None;
    }
    Some(MachineState {
        machine: reporter.machine.clone(),
        boot: reporter.boot,
        rev: prev.map_or(0, |s| s.rev + 1),
        herdr,
        caps: reporter.caps.clone(),
        agents,
    })
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
    fn rev_bumps_only_on_change() {
        let machine = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "m".into(),
            hostname: "h".into(),
            os: "macos".into(),
            version: "0".into(),
        };
        let reporter = Reporter { machine, caps: Caps::default(), boot: 7 };
        let ready = || HerdrState { status: HerdrStatus::Ready, version: None, protocol: None };
        let agents = derive_agents(fixture(), &[], 1);
        let first = next_state(&reporter, None, ready(), agents.clone()).unwrap();
        assert_eq!((first.rev, first.boot), (0, 7));
        assert!(next_state(&reporter, Some(&first), ready(), agents.clone()).is_none());
        let fewer = next_state(&reporter, Some(&first), ready(), agents[..1].to_vec());
        assert_eq!(fewer.map(|s| s.rev), Some(1));
    }

    #[test]
    fn agent_kinds_are_those_on_the_path() {
        let (bin, other) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(bin.path().join("claude"), "").unwrap();
        std::fs::write(other.path().join("cursor-agent"), "").unwrap();
        let path = std::env::join_paths([bin.path(), other.path()]).unwrap();
        assert_eq!(agent_kinds(Some(&path)), ["claude", "cursor"]);
        assert!(agent_kinds(None).is_empty());
    }
}
