use std::time::Instant;

use clap::Subcommand;
use isbell_proto::state::HerdrStatus;
use serde_json::json;

use super::Ctx;
use super::output::{CliError, short_id};
use super::target::resolve_machine;

#[derive(Subcommand)]
pub enum MachineCmd {
    /// List machines seen in the last 15 minutes.
    List,
    /// Try a direct link to a machine and report how it went.
    Probe { machine: String },
}

pub async fn run(ctx: &Ctx, cmd: MachineCmd) -> Result<(), CliError> {
    match cmd {
        MachineCmd::List => list(ctx).await,
        MachineCmd::Probe { machine } => probe(ctx, &machine).await,
    }
}

/// Reports the outcome either way: a failed direct link is a finding, not an error.
async fn probe(ctx: &Ctx, machine: &str) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, machine)?;
    let started = Instant::now();
    let direct = session.direct(&state.machine.id, &ctx.config.stun()).await;
    let elapsed = started.elapsed();
    let name = &state.machine.name;
    match (ctx.out.json, direct) {
        (true, Ok(path)) => ctx.out.json(
            &json!({"machine": name, "direct": true, "ms": elapsed.as_millis(), "path": path}),
        ),
        (true, Err(err)) => {
            let error = json!({"code": err.code, "message": err.msg});
            ctx.out.json(&json!({"machine": name, "direct": false, "error": error}))
        }
        (false, Ok(path)) => {
            let secs = elapsed.as_secs_f64();
            let path = path.map_or_else(|| "path unknown".to_owned(), |path| path.to_string());
            println!("{name}: direct link ok in {secs:.2}s ({path})")
        }
        (false, Err(err)) => println!("{name}: direct link failed: {} ({})", err.msg, err.code),
    }
    Ok(())
}

async fn list(ctx: &Ctx) -> Result<(), CliError> {
    let machines = ctx.session().await?.machines();
    if ctx.out.json {
        let list: Vec<_> = machines
            .iter()
            .map(|(state, online)| serde_json::json!({"online": online, "state": state}))
            .collect();
        ctx.out.json(&list);
        return Ok(());
    }
    let rows: Vec<Vec<String>> = machines
        .iter()
        .map(|(state, online)| {
            let herdr = match state.herdr.status {
                HerdrStatus::Ready => state.herdr.version.clone().unwrap_or_else(|| "ready".into()),
                HerdrStatus::Unavailable => "unavailable".into(),
                HerdrStatus::Incompatible => "incompatible".into(),
            };
            vec![
                state.machine.name.clone(),
                short_id(&state.machine.id).to_owned(),
                if *online { "online" } else { "offline" }.into(),
                herdr,
                state.agents.len().to_string(),
            ]
        })
        .collect();
    ctx.out.table(&["NAME", "ID", "STATUS", "HERDR", "AGENTS"], &rows);
    Ok(())
}
