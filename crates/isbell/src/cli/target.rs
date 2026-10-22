//! `<machine>/<agent>` targets. Machines match by exact name, else by id prefix (≥ 4 chars);
//! the agent part is passed to herdr unchanged (agent name or pane id).

use isbell_proto::state::MachineState;

use super::output::{CliError, short_id};

const MIN_ID_PREFIX: usize = 4;

pub struct Target<'a> {
    pub machine: &'a str,
    pub agent: &'a str,
}

pub fn parse_target(target: &str) -> Result<Target<'_>, CliError> {
    match target.split_once('/') {
        Some((machine, agent)) if !machine.is_empty() && !agent.is_empty() => {
            Ok(Target { machine, agent })
        }
        _ => {
            Err(CliError::new("bad_target", format!("expected <machine>/<agent>, got {target:?}")))
        }
    }
}

pub fn resolve_machine<'m>(
    machines: &'m [(MachineState, bool)],
    query: &str,
) -> Result<&'m (MachineState, bool), CliError> {
    let by_name: Vec<_> = machines.iter().filter(|(s, _)| s.machine.name == query).collect();
    let matches = if by_name.is_empty() && query.len() >= MIN_ID_PREFIX {
        machines.iter().filter(|(s, _)| s.machine.id.starts_with(query)).collect()
    } else {
        by_name
    };
    match matches.as_slice() {
        [one] => Ok(one),
        [] => Err(CliError::new(
            "machine_not_found",
            format!("no machine named {query:?} (try `isbell machine list`)"),
        )),
        many => {
            let candidates: Vec<String> = many
                .iter()
                .map(|(s, _)| format!("{} ({})", s.machine.name, short_id(&s.machine.id)))
                .collect();
            Err(CliError::new(
                "machine_ambiguous",
                format!("{query:?} matches {}; use an id prefix", candidates.join(", ")),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::state::MachineInfo;
    use isbell_proto::state::{Caps, HerdrState, HerdrStatus};

    fn machine(id: &str, name: &str) -> (MachineState, bool) {
        let info = MachineInfo {
            id: id.into(),
            name: name.into(),
            hostname: "h".into(),
            os: "macos".into(),
            version: "0".into(),
        };
        let herdr = HerdrState { status: HerdrStatus::Ready, version: None, protocol: None };
        (
            MachineState {
                machine: info,
                boot: 0,
                rev: 0,
                herdr,
                caps: Caps::default(),
                agents: vec![],
            },
            true,
        )
    }

    #[test]
    fn parses_targets() {
        let t = parse_target("macmini/reviewer").unwrap();
        assert_eq!((t.machine, t.agent), ("macmini", "reviewer"));
        assert_eq!(parse_target("macmini/w1:p1").unwrap().agent, "w1:p1");
        assert!(parse_target("macmini").is_err());
        assert!(parse_target("/reviewer").is_err());
    }

    #[test]
    fn resolves_by_name_then_id_prefix() {
        let machines =
            [machine("aaaa111111111111", "macmini"), machine("bbbb222222222222", "laptop")];
        assert_eq!(resolve_machine(&machines, "laptop").unwrap().0.machine.id, "bbbb222222222222");
        assert_eq!(resolve_machine(&machines, "aaaa1").unwrap().0.machine.name, "macmini");
        assert_eq!(resolve_machine(&machines, "zzzz").unwrap_err().code, "machine_not_found");
        assert_eq!(
            resolve_machine(&machines, "aaa").unwrap_err().code,
            "machine_not_found",
            "prefix too short"
        );
    }

    #[test]
    fn duplicate_names_are_ambiguous() {
        let machines = [machine("aaaa111111111111", "mac"), machine("bbbb222222222222", "mac")];
        let err = resolve_machine(&machines, "mac").unwrap_err();
        assert_eq!(err.code, "machine_ambiguous");
        assert!(err.message.contains("aaaa1111") && err.message.contains("bbbb2222"));
    }
}
