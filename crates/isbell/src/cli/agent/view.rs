//! How agent command results are shown: tables and lines on a terminal, JSON otherwise.

use isbell_proto::state::MachineState;
use serde_json::{Value, json};

use crate::cli::Ctx;
use crate::cli::output::{CliError, age, value_str};

pub fn list_json(machines: &[(MachineState, bool)]) -> Vec<Value> {
    machines
        .iter()
        .flat_map(|(s, online)| {
            s.agents.iter().map(move |a| json!({"machine": s.machine.name, "machineId": s.machine.id, "online": online, "agent": a}))
        })
        .collect()
}

pub fn list_rows(machines: &[(MachineState, bool)], now: u64) -> Vec<Vec<String>> {
    machines
        .iter()
        .flat_map(|(s, online)| {
            s.agents.iter().map(move |a| {
                let status = a.status.as_str();
                vec![
                    s.machine.name.clone(),
                    a.label().to_owned(),
                    a.kind.clone().unwrap_or_default(),
                    if *online { status.to_owned() } else { format!("{status} (offline)") },
                    age(a.status_since, now),
                    a.cwd.clone().unwrap_or_default(),
                ]
            })
        })
        .collect()
}

pub fn print_read(ctx: &Ctx, result: &Value) -> Result<(), CliError> {
    if ctx.out.json {
        ctx.out.json(result);
    } else {
        let text = value_str(&result["read"]["text"]);
        print!("{text}");
        if !text.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}

/// Prints the agent of an `agent_prompted` / `agent_info` result as `label: status`, or the JSON.
pub fn print_agent_result(ctx: &Ctx, result: &Value) -> Result<(), CliError> {
    if ctx.out.json {
        ctx.out.json(result);
    } else {
        let agent = &result["agent"];
        let label = agent["name"].as_str().or(agent["pane_id"].as_str()).unwrap_or("agent");
        println!("{label}: {}", value_str(&agent["agent_status"]));
    }
    Ok(())
}

/// Prints a herdr result only as JSON; on a terminal these commands are silent on success.
pub fn print_ok(ctx: &Ctx, result: &Value) -> Result<(), CliError> {
    if ctx.out.json {
        ctx.out.json(result);
    }
    Ok(())
}
