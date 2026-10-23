//! Command line: `isbell <resource> <verb> [target]`.

mod agent;
mod file;
mod gateway;
mod machine;
mod output;
mod space;
mod target;
mod terminal;
mod watch;

use clap::{Parser, Subcommand};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineState;

use crate::client::Session;
use crate::config::{Config, Paths, resolve_relay};
use output::{CliError, Output};
use target::resolve_machine;

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
    /// How terminals and files reach a machine.
    #[arg(long, global = true, value_enum, default_value_t = Transport::Auto)]
    transport: Transport,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// The space this machine belongs to.
    #[command(subcommand)]
    Space(space::SpaceCmd),
    /// This machine's gateway: run it, or run it as a service.
    #[command(subcommand)]
    Gateway(gateway::GatewayCmd),
    /// Machines in the space.
    #[command(subcommand)]
    Machine(machine::MachineCmd),
    /// Agents on the space's machines.
    #[command(subcommand)]
    Agent(agent::AgentCmd),
    /// Files on the space's machines.
    #[command(subcommand)]
    File(file::FileCmd),
    /// Remote terminals: attach to a pane, or open a new shell.
    #[command(subcommand)]
    Terminal(terminal::TerminalCmd),
    /// Stream presence and agent status changes as NDJSON.
    Watch,
}

#[derive(Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum Transport {
    /// A direct link when one can be opened, else the relay.
    Auto,
    /// A direct link, or fail.
    Direct,
    /// Always the relay.
    Relay,
}

/// Shared state for one command invocation.
pub struct Ctx {
    out: Output,
    paths: Paths,
    config: Config,
    relay: String,
    key: Option<String>,
    transport: Transport,
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

    /// Connects, then finds machine `query` by name or id prefix.
    async fn machine(&self, query: &str) -> Result<(Session, MachineState), CliError> {
        let session = self.session().await?;
        let state = resolve_machine(&session.machines(), query)?.0.clone();
        Ok((session, state))
    }

    /// Opens a direct link to machine `mid` as `--transport` asks; streams to it use the link.
    async fn reach(&self, session: &Session, mid: &str) -> Result<(), CliError> {
        if self.transport == Transport::Relay {
            return Ok(());
        }
        match session.direct(mid, &self.config.stun()).await {
            Ok(_) => Ok(()),
            Err(err) if self.transport == Transport::Auto => {
                tracing::warn!("direct link failed ({}: {}); using the relay", err.code, err.msg);
                Ok(())
            }
            Err(err) => Err(err.into()),
        }
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
        transport: cli.transport,
    };
    match cli.command {
        Command::Space(cmd) => space::run(&ctx, cmd),
        Command::Gateway(cmd) => gateway::run(ctx, cmd).await,
        Command::Machine(cmd) => machine::run(&ctx, cmd).await,
        Command::Agent(cmd) => agent::run(&ctx, cmd).await,
        Command::File(cmd) => file::run(&ctx, cmd).await,
        Command::Terminal(cmd) => terminal::run(&ctx, cmd).await,
        Command::Watch => watch::run(&ctx).await,
    }
}
