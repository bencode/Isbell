//! Machines: their identity, and the state a gateway reports (the relay caches and forwards it
//! without interpreting it).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineInfo {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub os: String,
    pub version: String,
}

/// Machine ids are 16 lowercase hex characters.
pub fn is_machine_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

impl MachineInfo {
    pub fn is_valid(&self) -> bool {
        is_machine_id(&self.id)
            && self.name.len() <= 64
            && self.hostname.len() <= 255
            && self.os.len() <= 32
            && self.version.len() <= 32
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineState {
    pub machine: MachineInfo,
    /// Gateway start time (ms); with `rev` it orders states from the same machine.
    pub boot: u64,
    pub rev: u64,
    pub herdr: HerdrState,
    pub caps: Caps,
    pub agents: Vec<Agent>,
}

impl MachineState {
    pub fn is_newer_than(&self, other: &MachineState) -> bool {
        (self.boot, self.rev) > (other.boot, other.rev)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrState {
    pub status: HerdrStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HerdrStatus {
    Ready,
    Unavailable,
    Incompatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    /// Methods the gateway accepts (herdr methods by name, plus `isbell.*`).
    pub methods: Vec<String>,
    /// Agent kinds whose executable was found on the gateway's PATH.
    pub agent_kinds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub pane_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub status: AgentStatus,
    /// When the gateway observed the current status (ms, gateway clock).
    pub status_since: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl Agent {
    /// The name when set, else the pane id; both are valid herdr targets.
    pub fn label(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.pane_id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    Blocked,
    Done,
    /// Also any status a newer herdr may add.
    #[serde(other)]
    Unknown,
}

impl AgentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentStatus::Idle => "idle",
            AgentStatus::Working => "working",
            AgentStatus::Blocked => "blocked",
            AgentStatus::Done => "done",
            AgentStatus::Unknown => "unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_machine_info() {
        let valid = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "n".into(),
            hostname: "h".into(),
            os: "o".into(),
            version: "v".into(),
        };
        assert!(valid.is_valid());
        let upper = MachineInfo {
            id: "0123456789ABCDEF".into(),
            ..valid
        };
        assert!(!upper.is_valid());
    }
}
