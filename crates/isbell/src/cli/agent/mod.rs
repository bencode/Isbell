//! `isbell agent …`: agents on the space's machines, driven through herdr on each machine.

mod request;
mod view;

use clap::Subcommand;
use isbell_proto::state::MachineState;
use serde_json::{Value, json};

use self::request::{HerdrRequest, START_TIMEOUT, Source, Status, WaitSpec, find_agent};
use self::view::{list_json, list_rows, print_agent_result, print_ok, print_read};
use super::Ctx;
use super::output::{CliError, value_str};
use super::target::{parse_target, resolve_machine};
use crate::client::Session;
use crate::now_ms;

#[derive(Subcommand)]
pub enum AgentCmd {
    /// List agents, optionally on one machine.
    List { machine: Option<String> },
    /// Show one agent as JSON.
    Get { target: String },
    /// Read the agent's terminal output.
    Read {
        target: String,
        #[arg(long, value_enum, default_value = "recent")]
        source: Source,
        #[arg(long)]
        lines: Option<u32>,
        /// Keep ANSI escape sequences.
        #[arg(long)]
        ansi: bool,
    },
    /// Send a prompt; with --wait, block until the agent settles.
    Prompt {
        target: String,
        text: String,
        #[arg(long)]
        wait: bool,
        /// Status to wait for (repeatable; default idle, done, blocked). Implies --wait.
        #[arg(long, value_enum)]
        until: Vec<Status>,
        /// Give up after this many milliseconds. Implies --wait.
        #[arg(long)]
        timeout: Option<u64>,
    },
    /// Block until the agent reaches a status.
    Wait {
        target: String,
        #[arg(long, value_enum)]
        until: Vec<Status>,
        #[arg(long)]
        timeout: Option<u64>,
    },
    /// Send keys such as enter, esc, up, down, tab, ctrl+c.
    SendKeys {
        target: String,
        #[arg(required = true)]
        keys: Vec<String>,
    },
    /// Start an agent in a new workspace. Quote `~` paths so they expand on the remote machine.
    Start {
        machine: String,
        #[arg(long)]
        cwd: String,
        #[arg(long)]
        kind: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        prompt: Option<String>,
        /// Extra arguments for the agent, after `--`.
        #[arg(last = true)]
        args: Vec<String>,
    },
    /// Rename an agent, or clear its name.
    Rename {
        target: String,
        #[arg(required_unless_present = "clear")]
        name: Option<String>,
        #[arg(long, conflicts_with = "name")]
        clear: bool,
    },
    /// Close the agent's pane.
    Close { target: String },
}

pub async fn run(ctx: &Ctx, cmd: AgentCmd) -> Result<(), CliError> {
    match cmd {
        AgentCmd::List { machine } => list(ctx, machine.as_deref()).await,
        AgentCmd::Get { target } => get(ctx, &target).await,
        AgentCmd::Read { target, source, lines, ansi } => {
            let read = |_: &_, agent: &str| Ok(request::read(agent, source, lines, ansi));
            print_read(ctx, &call_agent(ctx, &target, read).await?)
        }
        AgentCmd::Prompt { target, text, wait, until, timeout } => {
            let waits = wait || !until.is_empty() || timeout.is_some();
            let spec = waits.then_some(WaitSpec { until, timeout_ms: timeout });
            let prompt = |_: &_, agent: &str| Ok(request::prompt(agent, &text, spec));
            print_agent_result(ctx, &call_agent(ctx, &target, prompt).await?)
        }
        AgentCmd::Wait { target, until, timeout } => {
            let spec = WaitSpec { until, timeout_ms: timeout };
            let wait = |_: &_, agent: &str| Ok(request::wait(agent, spec));
            print_agent_result(ctx, &call_agent(ctx, &target, wait).await?)
        }
        AgentCmd::SendKeys { target, keys } => {
            let send = |_: &_, agent: &str| Ok(request::send_keys(agent, keys));
            print_ok(ctx, &call_agent(ctx, &target, send).await?)
        }
        AgentCmd::Start { machine, cwd, kind, name, prompt, args } => {
            let params =
                json!({"cwd": cwd, "kind": kind, "name": name, "prompt": prompt, "args": args});
            start(ctx, &machine, params).await
        }
        AgentCmd::Rename { target, name, clear } => {
            let rename = |_: &_, agent: &str| Ok(request::rename(agent, name.filter(|_| !clear)));
            print_agent_result(ctx, &call_agent(ctx, &target, rename).await?)
        }
        AgentCmd::Close { target } => {
            let close =
                |state: &_, agent: &str| Ok(request::close(&find_agent(state, agent)?.pane_id));
            print_ok(ctx, &call_agent(ctx, &target, close).await?)
        }
    }
}

async fn get(ctx: &Ctx, target: &str) -> Result<(), CliError> {
    let (_, state, agent) = open(ctx, target).await?;
    ctx.out.json(find_agent(&state, &agent)?);
    Ok(())
}

/// Connects and resolves `<machine>/<agent>` to (session, machine state, herdr target).
async fn open(ctx: &Ctx, target: &str) -> Result<(Session, MachineState, String), CliError> {
    let target = parse_target(target)?;
    let (session, state) = ctx.machine(target.machine).await?;
    Ok((session, state, target.agent.to_owned()))
}

/// Resolves the target, then sends the herdr request `build` makes for its machine and agent.
async fn call_agent(
    ctx: &Ctx,
    target: &str,
    build: impl FnOnce(&MachineState, &str) -> Result<HerdrRequest, CliError>,
) -> Result<Value, CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let req = build(&state, &agent)?;
    Ok(session.call(&state.machine.id, "herdr", req.passthrough(), req.timeout).await?)
}

async fn start(ctx: &Ctx, machine: &str, params: Value) -> Result<(), CliError> {
    let (session, state) = ctx.machine(machine).await?;
    let mid = &state.machine.id;
    let result = session.call(mid, "isbell.agent.start", params, Some(START_TIMEOUT)).await?;
    if ctx.out.json {
        ctx.out.json(&result);
    } else {
        let (name, pane) = (value_str(&result["name"]), value_str(&result["paneId"]));
        println!("started {}/{name} ({pane})", state.machine.name);
        if let Some(err) = result.get("promptError") {
            let (code, msg) = (value_str(&err["code"]), value_str(&err["msg"]));
            tracing::warn!("the agent runs, but its prompt was not sent ({code}: {msg})");
        }
    }
    Ok(())
}

async fn list(ctx: &Ctx, machine: Option<&str>) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let all = session.machines();
    let machines = match machine {
        Some(query) => vec![resolve_machine(&all, query)?.clone()],
        None => all,
    };
    match ctx.out.json {
        true => ctx.out.json(&list_json(&machines)),
        false => ctx.out.table(
            &["MACHINE", "AGENT", "KIND", "STATUS", "SINCE", "CWD"],
            &list_rows(&machines, now_ms()),
        ),
    }
    Ok(())
}
