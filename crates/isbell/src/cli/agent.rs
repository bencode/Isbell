use std::time::Duration;

use clap::{Subcommand, ValueEnum};
use isbell_proto::state::{Agent, MachineState};
use serde_json::{Value, json};

use super::Ctx;
use super::output::{CliError, age, value_str};
use super::target::{parse_target, resolve_machine};
use crate::client::Session;
use crate::now_ms;

/// Slightly above the gateway's 30s so its own timeout error arrives first.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);
/// The gateway's worst case: workspace 30s + busy retries 10s + start 35s + ready 30s + prompt 30s
/// = 135s, plus a margin so its own error arrives first.
const START_TIMEOUT: Duration = Duration::from_secs(150);
const WAIT_MARGIN: Duration = Duration::from_secs(10);

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

#[derive(Clone, Copy, ValueEnum)]
pub enum Source {
    Visible,
    Recent,
    RecentUnwrapped,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Status {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Idle => "idle",
            Status::Working => "working",
            Status::Blocked => "blocked",
            Status::Done => "done",
            Status::Unknown => "unknown",
        }
    }
}

fn wait_spec(until: &[Status], timeout: Option<u64>) -> Value {
    let mut wait = json!({});
    if !until.is_empty() {
        wait["until"] = json!(until.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    }
    if let Some(ms) = timeout {
        wait["timeout_ms"] = json!(ms);
    }
    wait
}

fn wait_timeout(timeout: Option<u64>) -> Option<Duration> {
    timeout.map(|ms| Duration::from_millis(ms) + WAIT_MARGIN)
}

/// Connects and resolves `<machine>/<agent>` to (session, machine state, herdr target).
async fn open(ctx: &Ctx, target: &str) -> Result<(Session, MachineState, String), CliError> {
    let target = parse_target(target)?;
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, target.machine)?;
    Ok((session, state.clone(), target.agent.to_owned()))
}

async fn herdr(
    session: &Session,
    mid: &str,
    method: &str,
    params: Value,
    timeout: Option<Duration>,
) -> Result<Value, CliError> {
    Ok(session
        .call(
            mid,
            "herdr",
            json!({"method": method, "params": params}),
            timeout,
        )
        .await?)
}

fn find_agent<'s>(state: &'s MachineState, agent: &str) -> Result<&'s Agent, CliError> {
    state
        .agents
        .iter()
        .find(|a| a.pane_id == agent || a.name.as_deref() == Some(agent))
        .ok_or_else(|| {
            CliError::new(
                "agent_not_found",
                format!("no agent {agent:?} on {}", state.machine.name),
            )
        })
}

/// Prints the agent of an `agent_prompted` / `agent_info` result as `label: status`, or the JSON.
fn print_agent_result(ctx: &Ctx, result: &Value) {
    if ctx.out.json {
        return ctx.out.json(result);
    }
    let agent = &result["agent"];
    let label = agent["name"]
        .as_str()
        .or(agent["pane_id"].as_str())
        .unwrap_or("agent");
    println!("{label}: {}", value_str(&agent["agent_status"]));
}

pub async fn run(ctx: &Ctx, cmd: AgentCmd) -> Result<(), CliError> {
    match cmd {
        AgentCmd::List { machine } => list(ctx, machine.as_deref()).await,
        AgentCmd::Get { target } => get(ctx, &target).await,
        AgentCmd::Read {
            target,
            source,
            lines,
            ansi,
        } => read(ctx, &target, source, lines, ansi).await,
        AgentCmd::Prompt {
            target,
            text,
            wait,
            until,
            timeout,
        } => prompt(ctx, &target, &text, wait, &until, timeout).await,
        AgentCmd::Wait {
            target,
            until,
            timeout,
        } => wait(ctx, &target, &until, timeout).await,
        AgentCmd::SendKeys { target, keys } => send_keys(ctx, &target, keys).await,
        AgentCmd::Start {
            machine,
            cwd,
            kind,
            name,
            prompt,
            args,
        } => {
            start(
                ctx,
                &machine,
                json!({"cwd": cwd, "kind": kind, "name": name, "prompt": prompt, "args": args}),
            )
            .await
        }
        AgentCmd::Rename {
            target,
            name,
            clear,
        } => rename(ctx, &target, if clear { None } else { name }).await,
        AgentCmd::Close { target } => close(ctx, &target).await,
    }
}

/// Prints a herdr result only as JSON; on a terminal these commands are silent on success.
fn print_ok(ctx: &Ctx, result: &Value) {
    if ctx.out.json {
        ctx.out.json(result);
    }
}

async fn get(ctx: &Ctx, target: &str) -> Result<(), CliError> {
    let (_, state, agent) = open(ctx, target).await?;
    ctx.out.json(find_agent(&state, &agent)?);
    Ok(())
}

async fn read(
    ctx: &Ctx,
    target: &str,
    source: Source,
    lines: Option<u32>,
    ansi: bool,
) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let source = match source {
        Source::Visible => "visible",
        Source::Recent => "recent",
        Source::RecentUnwrapped => "recent_unwrapped",
    };
    let params = json!({
        "target": agent, "source": source, "lines": lines,
        "format": if ansi { "ansi" } else { "text" }, "strip_ansi": !ansi,
    });
    let result = herdr(
        &session,
        &state.machine.id,
        "agent.read",
        params,
        Some(CALL_TIMEOUT),
    )
    .await?;
    if ctx.out.json {
        ctx.out.json(&result);
    } else {
        let text = value_str(&result["read"]["text"]);
        print!("{text}");
        if !text.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}

async fn prompt(
    ctx: &Ctx,
    target: &str,
    text: &str,
    wait: bool,
    until: &[Status],
    timeout: Option<u64>,
) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let waiting = wait || !until.is_empty() || timeout.is_some();
    let mut params = json!({"target": agent, "text": text});
    if waiting {
        params["wait"] = wait_spec(until, timeout);
    }
    let limit = if waiting {
        wait_timeout(timeout)
    } else {
        Some(CALL_TIMEOUT)
    };
    let result = herdr(&session, &state.machine.id, "agent.prompt", params, limit).await?;
    print_agent_result(ctx, &result);
    Ok(())
}

async fn wait(
    ctx: &Ctx,
    target: &str,
    until: &[Status],
    timeout: Option<u64>,
) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let mut params = wait_spec(until, timeout);
    params["target"] = json!(agent);
    let result = herdr(
        &session,
        &state.machine.id,
        "agent.wait",
        params,
        wait_timeout(timeout),
    )
    .await?;
    print_agent_result(ctx, &result);
    Ok(())
}

async fn send_keys(ctx: &Ctx, target: &str, keys: Vec<String>) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let params = json!({"target": agent, "keys": keys});
    let result = herdr(
        &session,
        &state.machine.id,
        "agent.send_keys",
        params,
        Some(CALL_TIMEOUT),
    )
    .await?;
    print_ok(ctx, &result);
    Ok(())
}

async fn start(ctx: &Ctx, machine: &str, params: Value) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, machine)?;
    let result = session
        .call(
            &state.machine.id,
            "isbell.agent.start",
            params,
            Some(START_TIMEOUT),
        )
        .await?;
    if ctx.out.json {
        ctx.out.json(&result);
    } else {
        let (name, pane) = (value_str(&result["name"]), value_str(&result["paneId"]));
        println!("started {}/{name} ({pane})", state.machine.name);
    }
    Ok(())
}

async fn rename(ctx: &Ctx, target: &str, name: Option<String>) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let params = json!({"target": agent, "name": name});
    let result = herdr(
        &session,
        &state.machine.id,
        "agent.rename",
        params,
        Some(CALL_TIMEOUT),
    )
    .await?;
    print_agent_result(ctx, &result);
    Ok(())
}

async fn close(ctx: &Ctx, target: &str) -> Result<(), CliError> {
    let (session, state, agent) = open(ctx, target).await?;
    let pane_id = find_agent(&state, &agent)?.pane_id.clone();
    let result = herdr(
        &session,
        &state.machine.id,
        "pane.close",
        json!({"pane_id": pane_id}),
        Some(CALL_TIMEOUT),
    )
    .await?;
    print_ok(ctx, &result);
    Ok(())
}

async fn list(ctx: &Ctx, machine: Option<&str>) -> Result<(), CliError> {
    let session = ctx.session().await?;
    let all = session.machines();
    let machines = match machine {
        Some(query) => vec![resolve_machine(&all, query)?.clone()],
        None => all,
    };
    if ctx.out.json {
        let agents: Vec<_> = machines
            .iter()
            .flat_map(|(s, online)| {
                s.agents.iter().map(move |a| json!({"machine": s.machine.name, "machineId": s.machine.id, "online": online, "agent": a}))
            })
            .collect();
        ctx.out.json(&agents);
        return Ok(());
    }
    let now = now_ms();
    let rows: Vec<Vec<String>> = machines
        .iter()
        .flat_map(|(s, online)| {
            s.agents.iter().map(move |a| {
                vec![
                    s.machine.name.clone(),
                    a.label().to_owned(),
                    a.kind.clone().unwrap_or_default(),
                    if *online {
                        a.status.as_str().to_owned()
                    } else {
                        format!("{} (offline)", a.status.as_str())
                    },
                    age(a.status_since, now),
                    a.cwd.clone().unwrap_or_default(),
                ]
            })
        })
        .collect();
    ctx.out.table(
        &["MACHINE", "AGENT", "KIND", "STATUS", "SINCE", "CWD"],
        &rows,
    );
    Ok(())
}
