use clap::Subcommand;
use isbell_proto::state::HerdrStatus;

use super::Ctx;
use super::output::{CliError, short_id};

#[derive(Subcommand)]
pub enum MachineCmd {
    /// List machines seen in the last 15 minutes.
    List,
}

pub async fn run(ctx: &Ctx, cmd: MachineCmd) -> Result<(), CliError> {
    let MachineCmd::List = cmd;
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
