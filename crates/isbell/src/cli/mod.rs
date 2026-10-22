//! Command line: `isbell <resource> <verb> [target]`.

mod agent;
mod machine;
pub mod output;
mod space;
pub mod target;
mod terminal;
mod watch;

use clap::{Parser, Subcommand};
use isbell_proto::identity::Identity;

use crate::client::Session;
use crate::config::{Config, MachineConfig, Paths, resolve_relay};
use crate::gateway::{self, GatewayError, GatewayOptions};
use crate::relay::RelayError;
use output::{CliError, Output};

#[derive(Parser)]
#[command(name = "isbell", version, about = "Remote access to herdr agents across your machines")]
pub struct Cli {
    /// Relay WebSocket URL.
    #[arg(long, global = true, env = "ISBELL_RELAY")]
    relay: Option<String>,
    /// Space key (defaults to this machine's key file).
    #[arg(long, global = true, env = "ISBELL_KEY", hide_env_values = true)]
    key: Option<String>,
    /// Print JSON even on a terminal.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// The space this machine belongs to.
    #[command(subcommand)]
    Space(space::SpaceCmd),
    /// Run this machine's gateway.
    #[command(subcommand)]
    Gateway(GatewayCmd),
    /// Machines in the space.
    #[command(subcommand)]
    Machine(machine::MachineCmd),
    /// Agents on the space's machines.
    #[command(subcommand)]
    Agent(agent::AgentCmd),
    /// Remote terminals: attach to a pane, or open a new shell.
    #[command(subcommand)]
    Terminal(terminal::TerminalCmd),
    /// Stream presence and agent status changes as NDJSON.
    Watch,
}

#[derive(Subcommand)]
enum GatewayCmd {
    /// Run the gateway in the foreground.
    Run,
}

/// Shared state for one command invocation.
pub struct Ctx {
    out: Output,
    paths: Paths,
    config: Config,
    relay: String,
    key: Option<String>,
}

impl Ctx {
    fn identity(&self) -> Result<Identity, CliError> {
        if let Some(key) = &self.key {
            return Identity::parse(key).map_err(|err| CliError::new("bad_key", err.to_string()));
        }
        self.paths.read_key()?.ok_or_else(|| {
            CliError::new(
                "no_space",
                "no space key: run `isbell space init`, `isbell space join <key>`, or pass --key",
            )
        })
    }

    async fn session(&self) -> Result<Session, CliError> {
        Session::connect(&self.relay, &self.identity()?)
            .await
            .map_err(|err| CliError::new("relay_error", err.to_string()))
    }
}

pub async fn run(cli: Cli) -> Result<(), CliError> {
    let paths = Paths::resolve()?;
    let config = paths.load()?;
    let ctx = Ctx {
        out: Output::new(cli.json),
        relay: resolve_relay(cli.relay.as_deref(), &config),
        paths,
        config,
        key: cli.key,
    };
    match cli.command {
        Command::Space(cmd) => space::run(&ctx, cmd),
        Command::Gateway(GatewayCmd::Run) => run_gateway(ctx).await,
        Command::Machine(cmd) => machine::run(&ctx, cmd).await,
        Command::Agent(cmd) => agent::run(&ctx, cmd).await,
        Command::Terminal(cmd) => terminal::run(&ctx, cmd).await,
        Command::Watch => watch::run(&ctx).await,
    }
}

async fn run_gateway(mut ctx: Ctx) -> Result<(), CliError> {
    let identity = ctx.identity()?;
    let machine = match ctx.config.machine.clone() {
        Some(machine) => machine,
        None => {
            let machine = MachineConfig::generate();
            ctx.config.machine = Some(machine.clone());
            ctx.paths.save(&ctx.config)?;
            machine
        }
    };
    tracing::info!(machine = %machine.name, id = %machine.id, "starting gateway");
    let opts = GatewayOptions { relay: ctx.relay, identity, machine: machine.info() };
    gateway::run(opts).await.map_err(|err| {
        let code = match err {
            GatewayError::Relay(RelayError::Replaced) => "gateway_replaced",
            GatewayError::Relay(_) => "relay_error",
            GatewayError::StateLoopStopped => "gateway_failed",
        };
        CliError::new(code, err.to_string())
    })
}
