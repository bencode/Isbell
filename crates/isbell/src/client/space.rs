//! What a client knows of its space: each machine's latest state, and whether it is online.

use std::collections::{BTreeMap, HashMap};

use isbell_proto::frame::SnapshotEntry;
use isbell_proto::state::MachineState;

#[derive(Default)]
pub struct Space {
    states: HashMap<String, MachineState>,
    online: HashMap<String, bool>,
}

impl Space {
    /// The space as the relay's snapshot describes it; unreadable states are skipped.
    pub fn from_snapshot(entries: Vec<SnapshotEntry>) -> Space {
        let read: Vec<(MachineState, bool)> = entries
            .into_iter()
            .filter_map(|entry| {
                serde_json::from_value::<MachineState>(entry.state)
                    .inspect_err(|err| tracing::warn!(%err, "ignoring unreadable machine state"))
                    .ok()
                    .map(|state| (state, entry.online))
            })
            .collect();
        Space {
            online: read.iter().map(|(s, online)| (s.machine.id.clone(), *online)).collect(),
            states: read.into_iter().map(|(s, _)| (s.machine.id.clone(), s)).collect(),
        }
    }

    /// Every known machine with its online flag, ordered by name (then id).
    pub fn machines(&self) -> Vec<(MachineState, bool)> {
        self.states
            .values()
            .map(|s| {
                let online = self.online.get(&s.machine.id).copied().unwrap_or(false);
                ((&s.machine.name, &s.machine.id), (s.clone(), online))
            })
            .collect::<BTreeMap<_, _>>()
            .into_values()
            .collect()
    }

    /// The gateway process last seen serving `mid`.
    pub fn boot(&self, mid: &str) -> Option<u64> {
        self.states.get(mid).map(|s| s.boot)
    }

    /// Keeps `state` unless an equal or newer one is known; true when kept.
    pub fn record(&mut self, state: MachineState) -> bool {
        let newer = self.states.get(&state.machine.id).is_none_or(|old| state.is_newer_than(old));
        if newer {
            self.states.insert(state.machine.id.clone(), state);
        }
        newer
    }

    pub fn set_online(&mut self, mid: String, online: bool) {
        self.online.insert(mid, online);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn state(id: &str, name: &str, boot: u64, rev: u64) -> Value {
        json!({
            "machine": {"id": id, "name": name, "hostname": "h", "os": "macos", "version": "0"},
            "boot": boot, "rev": rev,
            "herdr": {"status": "ready"}, "caps": {"methods": [], "agentKinds": []}, "agents": [],
        })
    }

    fn snapshot(states: &[(Value, bool)]) -> Space {
        let entries = states
            .iter()
            .map(|(state, online)| SnapshotEntry { state: state.clone(), online: *online });
        Space::from_snapshot(entries.collect())
    }

    #[test]
    fn reads_the_snapshot_skipping_unreadable_states() {
        let space = snapshot(&[
            (state("bbbb000000000000", "mac", 1, 0), true),
            (json!({"machine": "broken"}), true),
            (state("aaaa000000000000", "mac", 1, 0), false),
            (state("cccc000000000000", "box", 1, 0), true),
        ]);
        let machines = space.machines();
        let listed: Vec<(&str, &str, bool)> = machines
            .iter()
            .map(|(s, online)| (s.machine.name.as_str(), &s.machine.id[..4], *online))
            .collect();
        assert_eq!(listed, [("box", "cccc", true), ("mac", "aaaa", false), ("mac", "bbbb", true)]);
    }

    #[test]
    fn keeps_only_newer_states() {
        let mut space = Space::default();
        let read = |v: Value| serde_json::from_value::<MachineState>(v).unwrap();
        assert!(space.record(read(state("aaaa000000000000", "mac", 2, 5))));
        assert!(!space.record(read(state("aaaa000000000000", "mac", 2, 5))), "same state");
        assert!(!space.record(read(state("aaaa000000000000", "mac", 1, 9))), "older process");
        assert!(space.record(read(state("aaaa000000000000", "mac", 2, 6))));
        assert_eq!(space.boot("aaaa000000000000"), Some(2));
    }
}
