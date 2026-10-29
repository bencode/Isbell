//! `isbell gateway run`: keeps this machine's herdr state reported to the relay and serves requests.

mod calls;
mod direct;
mod file;
mod git;
mod herdr;
mod link;
mod monitor;
mod push;
mod rpc;
mod state;
mod stream;
mod terminal;
mod uplink;
mod workspace;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, MachineInfo};
use tokio::sync::{mpsc, watch};

use self::calls::Calls;
use self::herdr::Herdr;
use self::push::Push;
use self::state::Reporter;
use crate::relay::RelayError;
use crate::{AbortOnDrop, now_ms};

pub struct GatewayOptions {
    pub relay: String,
    pub identity: Identity,
    pub machine: MachineInfo,
    /// STUN servers for direct links.
    pub ice: Vec<String>,
    /// Where files sent for agents go.
    pub uploads: PathBuf,
    /// Where the phones subscribed to pushes are kept.
    pub push: PathBuf,
}

/// Shared between the monitor (which discovers herdr) and the calls.
type HerdrSlot = Arc<RwLock<Option<Herdr>>>;

#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
    #[error(transparent)]
    Relay(#[from] RelayError),
    /// The herdr monitor ended, which only a bug can cause; state would never be reported again.
    #[error("the herdr monitor stopped unexpectedly")]
    MonitorStopped,
}

/// Runs until another gateway takes over this machine, the relay URL / origin is unusable, or the
/// monitor dies.
pub async fn run(opts: GatewayOptions) -> Result<(), GatewayError> {
    let slot: HerdrSlot = Arc::default();
    let (states, states_rx) = watch::channel(None);
    let (refresh, refresh_rx) = mpsc::channel(1);
    let path = std::env::var_os("PATH");
    let caps = Caps { methods: calls::methods(), agent_kinds: state::agent_kinds(path.as_deref()) };
    let reporter = Reporter { machine: opts.machine.clone(), caps, boot: now_ms() };
    let monitor = monitor::run(reporter, Arc::clone(&slot), states, refresh.clone(), refresh_rx);
    let mut monitor = AbortOnDrop(tokio::spawn(monitor));
    let push = Arc::new(Push::new(&opts.identity, opts.push.clone(), &opts.relay));
    let _push = AbortOnDrop(tokio::spawn(push::run(Arc::clone(&push), states_rx.clone())));
    let (inbox, inbox_rx) = mpsc::unbounded_channel();
    tracing::info!(uploads = %opts.uploads.display(), "files sent for agents go here");
    let calls =
        Calls::new(slot, refresh, opts.ice.clone(), opts.uploads.clone(), push, inbox.clone());
    let _calls = AbortOnDrop(tokio::spawn(calls::run(calls, inbox_rx)));
    tokio::select! {
        result = uplink::run(&opts, inbox, states_rx) => Ok(result?),
        joined = &mut monitor.0 => {
            if let Err(err) = joined {
                tracing::error!(%err, "herdr monitor failed");
            }
            Err(GatewayError::MonitorStopped)
        }
    }
}

/// Asks the monitor to publish the current state soon; one pending request is enough.
fn nudge(refresh: &mpsc::Sender<()>) {
    if refresh.try_send(()).is_err() {
        tracing::trace!("refresh already pending");
    }
}
