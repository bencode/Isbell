//! `isbell gateway …`: the gateway in the foreground, or as a login service.

use clap::Subcommand;
use serde_json::json;

use super::Ctx;
use super::output::CliError;
use crate::config::MachineConfig;
use crate::gateway::{self, GatewayError, GatewayOptions};
use crate::relay::RelayError;
use crate::service;

#[derive(Subcommand)]
pub enum GatewayCmd {
    /// Run the gateway in the foreground.
    Run,
    /// Run the gateway as a login service (macOS): now, at every login, and again after a failure.
    Install,
    /// Stop the service and remove it; the herdr server keeps running.
    Uninstall,
    /// Whether the service is installed and running.
    Status,
}

pub async fn run(ctx: Ctx, cmd: GatewayCmd) -> Result<(), CliError> {
    if !matches!(cmd, GatewayCmd::Run) && !cfg!(target_os = "macos") {
        return Err(CliError::new("unsupported", "the gateway service needs macOS (launchd)"));
    }
    match cmd {
        GatewayCmd::Run => run_gateway(ctx).await,
        GatewayCmd::Install => install(&ctx),
        GatewayCmd::Uninstall => uninstall(&ctx),
        GatewayCmd::Status => status(&ctx),
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
    let opts = GatewayOptions {
        relay: ctx.relay,
        identity,
        machine: machine.info(),
        ice: ctx.config.stun(),
        uploads: ctx.config.uploads(),
    };
    match gateway::run(opts).await {
        // A clean exit, so a service manager leaves the machine to the other gateway.
        Err(GatewayError::Relay(RelayError::Replaced)) => {
            tracing::warn!("another gateway took over this machine; exiting");
            Ok(())
        }
        Err(err @ GatewayError::Relay(_)) => Err(CliError::new("relay_error", err.to_string())),
        Err(err @ GatewayError::MonitorStopped) => {
            Err(CliError::new("gateway_failed", err.to_string()))
        }
        Ok(()) => Ok(()),
    }
}

/// Records this shell's PATH for the service, so it finds herdr and the agents.
fn install(ctx: &Ctx) -> Result<(), CliError> {
    ctx.identity()?;
    let exe = std::env::current_exe().map_err(anyhow::Error::from)?;
    let files = service::install(&exe, &std::env::var_os("PATH").unwrap_or_default())?;
    match ctx.out.json {
        true => ctx.out.json(&files),
        false => println!(
            "gateway service installed and started\n  {}\n  log: {}",
            files.plist.display(),
            files.log.display()
        ),
    }
    Ok(())
}

fn uninstall(ctx: &Ctx) -> Result<(), CliError> {
    let removed = service::uninstall()?;
    match (ctx.out.json, removed) {
        (true, _) => ctx.out.json(&json!({"removed": removed})),
        (false, true) => println!("gateway service stopped and removed"),
        (false, false) => println!("gateway service not installed"),
    }
    Ok(())
}

fn status(ctx: &Ctx) -> Result<(), CliError> {
    let status = service::status()?;
    match (ctx.out.json, &status) {
        (true, _) => ctx.out.json(&status),
        (false, service::Status { pid: Some(pid), .. }) => println!("running (pid {pid})"),
        (false, service::Status { installed: true, .. }) => println!("installed, not running"),
        (false, _) => println!("not installed"),
    }
    Ok(())
}
