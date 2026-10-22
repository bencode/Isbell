//! Command line: `isbell <resource> <verb> [target]`, plus the relay client session it uses.

mod agent;
mod machine;
pub mod output;
mod space;
pub mod target;
mod watch;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use clap::{Parser, Subcommand};
use isbell_proto::frame::{Frame, Header, RpcError};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineState;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::config::{Config, MachineConfig, Paths, resolve_relay};
use crate::gateway::{self, GatewayOptions};
use crate::relay::{self, FrameStream};
use output::{CliError, Output};

const RELAY_IDLE: Duration = Duration::from_secs(45);

#[derive(Parser)]
#[command(
    name = "isbell",
    version,
    about = "Remote access to herdr agents across your machines"
)]
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
        Ok(Session::connect(&self.relay, &self.identity()?).await?)
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
    let opts = GatewayOptions {
        relay: ctx.relay,
        identity,
        machine: machine.info(),
    };
    Ok(gateway::run(opts).await?)
}

// ---------- client session ----------

#[derive(Debug, Clone)]
pub enum SessionEvent {
    State(Box<MachineState>),
    Presence { mid: String, online: bool },
    Closed,
}

type Pending = HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>;

#[derive(Default)]
struct Shared {
    states: HashMap<String, MachineState>,
    online: HashMap<String, bool>,
}

/// A client connection to the relay: the space snapshot, live updates, and calls to machines.
pub struct Session {
    shared: Arc<Mutex<Shared>>,
    pending: Arc<Mutex<Option<Pending>>>,
    out: mpsc::UnboundedSender<Frame>,
    events: broadcast::Sender<SessionEvent>,
    next_id: AtomicU64,
}

impl Session {
    pub async fn connect(url: &str, id: &Identity) -> Result<Session, crate::relay::RelayError> {
        let mut conn = relay::connect(url, id, None).await?;
        let Header::Snapshot { machines } = conn.stream.next(RELAY_IDLE).await?.header else {
            return Err(crate::relay::RelayError::Protocol(
                "expected snapshot".into(),
            ));
        };
        let mut shared = Shared::default();
        for entry in machines {
            match serde_json::from_value::<MachineState>(entry.state) {
                Ok(state) => {
                    shared.online.insert(state.machine.id.clone(), entry.online);
                    shared.states.insert(state.machine.id.clone(), state);
                }
                Err(err) => tracing::warn!(%err, "ignoring unreadable machine state"),
            }
        }
        let shared = Arc::new(Mutex::new(shared));
        let pending = Arc::new(Mutex::new(Some(Pending::new())));
        let (events, _) = broadcast::channel(256);
        let (out, mut out_rx) = mpsc::unbounded_channel::<Frame>();
        let mut sink = conn.sink;
        tokio::spawn(async move {
            while let Some(frame) = out_rx.recv().await {
                if let Err(err) = sink.send(&frame).await {
                    tracing::debug!(%err, "relay write failed");
                    break;
                }
            }
        });
        tokio::spawn(read_loop(
            conn.stream,
            Arc::clone(&shared),
            Arc::clone(&pending),
            events.clone(),
        ));
        Ok(Session {
            shared,
            pending,
            out,
            events,
            next_id: AtomicU64::new(1),
        })
    }

    /// Every known machine with its online flag, ordered by name.
    pub fn machines(&self) -> Vec<(MachineState, bool)> {
        let shared = self.shared.lock().expect("session poisoned");
        let mut machines: Vec<_> = shared
            .states
            .values()
            .map(|s| {
                (
                    s.clone(),
                    shared.online.get(&s.machine.id).copied().unwrap_or(false),
                )
            })
            .collect();
        machines.sort_by(|a, b| {
            (&a.0.machine.name, &a.0.machine.id).cmp(&(&b.0.machine.name, &b.0.machine.id))
        });
        machines
    }

    pub fn events(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    /// Calls `m` on machine `mid`; `None` waits as long as the machine takes.
    pub async fn call(
        &self,
        mid: &str,
        m: &str,
        p: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        match self.pending.lock().expect("session poisoned").as_mut() {
            Some(pending) => pending.insert(id, tx),
            None => return Err(disconnected()),
        };
        let call = Header::Call {
            id,
            m: m.into(),
            p,
            mid: Some(mid.into()),
            from: None,
        };
        if self.out.send(Frame::new(call)).is_err() {
            return Err(disconnected());
        }
        let reply = match timeout {
            Some(limit) => tokio::time::timeout(limit, rx).await.map_err(|_| {
                self.forget(id);
                RpcError::new(
                    "timeout",
                    format!("no response within {}s", limit.as_secs()),
                )
            })?,
            None => rx.await,
        };
        reply.unwrap_or_else(|_| Err(disconnected()))
    }

    fn forget(&self, id: u64) {
        if let Some(pending) = self.pending.lock().expect("session poisoned").as_mut() {
            pending.remove(&id);
        }
    }
}

fn disconnected() -> RpcError {
    RpcError::new("disconnected", "lost the relay connection")
}

async fn read_loop(
    mut stream: FrameStream,
    shared: Arc<Mutex<Shared>>,
    pending: Arc<Mutex<Option<Pending>>>,
    events: broadcast::Sender<SessionEvent>,
) {
    let err = loop {
        let frame = match stream.next(RELAY_IDLE).await {
            Ok(frame) => frame,
            Err(err) => break err,
        };
        let event = match frame.header {
            Header::Res { id, ok, r, e, .. } => {
                let reply = if ok {
                    Ok(r.unwrap_or(Value::Null))
                } else {
                    Err(e.unwrap_or_else(|| RpcError::new("error", "")))
                };
                // A missing entry is a duplicate or late response; nobody is waiting for it.
                let waiter = pending
                    .lock()
                    .expect("session poisoned")
                    .as_mut()
                    .and_then(|p| p.remove(&id));
                if let Some(waiter) = waiter
                    && waiter.send(reply).is_err()
                {
                    tracing::debug!(id, "caller stopped waiting");
                }
                None
            }
            Header::State { state } => match serde_json::from_value::<MachineState>(state) {
                Ok(state) => {
                    let mut shared = shared.lock().expect("session poisoned");
                    let newer = shared
                        .states
                        .get(&state.machine.id)
                        .is_none_or(|old| state.is_newer_than(old));
                    newer.then(|| {
                        shared
                            .states
                            .insert(state.machine.id.clone(), state.clone());
                        SessionEvent::State(Box::new(state))
                    })
                }
                Err(err) => {
                    tracing::warn!(%err, "ignoring unreadable machine state");
                    None
                }
            },
            Header::Presence { mid, online } => {
                shared
                    .lock()
                    .expect("session poisoned")
                    .online
                    .insert(mid.clone(), online);
                Some(SessionEvent::Presence { mid, online })
            }
            _ => None,
        };
        if let Some(event) = event
            && events.send(event).is_err()
        {
            tracing::trace!("no event listeners");
        }
    };
    tracing::debug!(%err, "relay session ended");
    // Dropping the waiters makes every pending call fail with `disconnected`.
    pending.lock().expect("session poisoned").take();
    if events.send(SessionEvent::Closed).is_err() {
        tracing::trace!("no event listeners");
    }
}
