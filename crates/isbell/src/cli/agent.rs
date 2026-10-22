use std::time::Duration;

use clap::{Subcommand, ValueEnum};
use isbell_proto::state::{Agent, MachineState};
use serde_json::{Value, json};

use super::output::{CliError, age, value_str};
use super::target::{parse_target, resolve_machine};
use super::{Ctx, Session};
use crate::gateway::state::now_ms;

/// Slightly above the gateway's 30s so its own timeout error arrives first.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);
const START_TIMEOUT: Duration = Duration::from_secs(90);
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
        AgentCmd::List { machine } => list(ctx, machine.as_deref()).await?,
        AgentCmd::Get { target } => {
            let (_, state, agent) = open(ctx, &target).await?;
            ctx.out.json(find_agent(&state, &agent)?);
        }
        AgentCmd::Read {
            target,
            source,
            lines,
            ansi,
        } => {
            let (session, state, agent) = open(ctx, &target).await?;
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
        }
        AgentCmd::Prompt {
            target,
            text,
            wait,
            until,
            timeout,
        } => {
            let (session, state, agent) = open(ctx, &target).await?;
            let waiting = wait || !until.is_empty() || timeout.is_some();
            let mut params = json!({"target": agent, "text": text});
            if waiting {
                params["wait"] = wait_spec(&until, timeout);
            }
            let limit = if waiting {
                wait_timeout(timeout)
            } else {
                Some(CALL_TIMEOUT)
            };
            let result = herdr(&session, &state.machine.id, "agent.prompt", params, limit).await?;
            print_agent_result(ctx, &result);
        }
        AgentCmd::Wait {
            target,
            until,
            timeout,
        } => {
            let (session, state, agent) = open(ctx, &target).await?;
            let mut params = wait_spec(&until, timeout);
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
        }
        AgentCmd::SendKeys { target, keys } => {
            let (session, state, agent) = open(ctx, &target).await?;
            let params = json!({"target": agent, "keys": keys});
            let result = herdr(
                &session,
                &state.machine.id,
                "agent.send_keys",
                params,
                Some(CALL_TIMEOUT),
            )
            .await?;
            if ctx.out.json {
                ctx.out.json(&result);
            }
        }
        AgentCmd::Start {
            machine,
            cwd,
            kind,
            name,
            prompt,
            args,
        } => {
            let session = ctx.session().await?;
            let machines = session.machines();
            let (state, _) = resolve_machine(&machines, &machine)?;
            let params =
                json!({"cwd": cwd, "kind": kind, "name": name, "prompt": prompt, "args": args});
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
                println!(
                    "started {}/{} ({})",
                    state.machine.name,
                    value_str(&result["name"]),
                    value_str(&result["paneId"])
                );
            }
        }
        AgentCmd::Rename {
            target,
            name,
            clear,
        } => {
            let (session, state, agent) = open(ctx, &target).await?;
            let params = json!({"target": agent, "name": if clear { None } else { name }});
            let result = herdr(
                &session,
                &state.machine.id,
                "agent.rename",
                params,
                Some(CALL_TIMEOUT),
            )
            .await?;
            print_agent_result(ctx, &result);
        }
        AgentCmd::Close { target } => {
            let (session, state, agent) = open(ctx, &target).await?;
            let pane_id = find_agent(&state, &agent)?.pane_id.clone();
            let params = json!({"pane_id": pane_id});
            let result = herdr(
                &session,
                &state.machine.id,
                "pane.close",
                params,
                Some(CALL_TIMEOUT),
            )
            .await?;
            if ctx.out.json {
                ctx.out.json(&result);
            }
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
