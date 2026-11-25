//! Who runs a command: the agent session that the agent's own variables name.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
    Pi,
}

impl Agent {
    const ALL: [Agent; 3] = [Agent::Claude, Agent::Codex, Agent::Pi];

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|a| a.as_str() == s)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Pi => "pi",
        }
    }

    /// The variables the agent gives its commands: its session's id, and its directory when not
    /// its default.
    fn vars(self) -> (&'static str, &'static str) {
        match self {
            Agent::Claude => ("CLAUDE_CODE_SESSION_ID", "CLAUDE_CONFIG_DIR"),
            Agent::Codex => ("CODEX_THREAD_ID", "CODEX_HOME"),
            Agent::Pi => ("PI_SESSION_ID", "PI_CODING_AGENT_DIR"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Caller {
    pub agent: Agent,
    pub session: String,
    /// The agent's directory, when not its default.
    pub home: Option<PathBuf>,
    /// Pi's session file.
    pub path: Option<PathBuf>,
    /// The herdr pane the agent runs in.
    pub pane: Option<String>,
    pub dir: PathBuf,
}

/// The agent session running the command in `dir`, from `env`; none outside an agent.
pub fn caller(env: impl Fn(&str) -> Option<String>, dir: PathBuf) -> Option<Caller> {
    let set = |name: &str| env(name).filter(|v| !v.is_empty());
    let (agent, session) =
        Agent::ALL.into_iter().find_map(|agent| set(agent.vars().0).map(|id| (agent, id)))?;
    Some(Caller {
        agent,
        session,
        home: set(agent.vars().1).map(PathBuf::from),
        path: (agent == Agent::Pi).then(|| set("PI_SESSION_FILE").map(PathBuf::from)).flatten(),
        pane: set("HERDR_PANE_ID"),
        dir,
    })
}

/// The caller of this process.
pub fn this() -> Option<Caller> {
    let dir = std::env::current_dir().ok()?;
    caller(|name| std::env::var(name).ok(), dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from(vars: &[(&str, &str)]) -> Option<Caller> {
        let env = |name: &str| vars.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string());
        caller(env, PathBuf::from("/w"))
    }

    #[test]
    fn each_agent_is_told_by_its_own_variables() {
        let claude = from(&[
            ("CLAUDE_CODE_SESSION_ID", "c1"),
            ("CLAUDE_CONFIG_DIR", "/cc"),
            ("HERDR_PANE_ID", "w1:p2"),
        ])
        .unwrap();
        assert_eq!((claude.agent, claude.session.as_str()), (Agent::Claude, "c1"));
        assert_eq!(claude.home, Some(PathBuf::from("/cc")));
        assert_eq!(claude.pane.as_deref(), Some("w1:p2"));

        let codex = from(&[("CODEX_THREAD_ID", "x1")]).unwrap();
        assert_eq!((codex.agent, codex.home), (Agent::Codex, None));

        let pi = from(&[("PI_SESSION_ID", "p1"), ("PI_SESSION_FILE", "/s/p1.jsonl")]).unwrap();
        assert_eq!(pi.path, Some(PathBuf::from("/s/p1.jsonl")));
    }

    #[test]
    fn outside_an_agent_there_is_no_caller() {
        assert_eq!(from(&[("HERDR_PANE_ID", "w1:p2"), ("CLAUDE_CODE_SESSION_ID", "")]), None);
    }
}
