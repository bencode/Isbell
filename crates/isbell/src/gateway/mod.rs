//! `isbell gateway run`: keeps this machine's herdr state reported to the relay and serves requests.

mod calls;
mod herdr;
mod monitor;
mod rpc;
mod state;
mod terminal;
mod uplink;
mod workspace;

use std::sync::{Arc, RwLock};

use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, MachineInfo};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use self::calls::Calls;
use self::herdr::Herdr;
use self::state::Reporter;
use self::uplink::Outbox;
use crate::now_ms;
use crate::relay::RelayError;

pub struct GatewayOptions {
    pub relay: String,
    pub identity: Identity,
    pub machine: MachineInfo,
}

/// Shared between the monitor (which discovers herdr) and the calls.
type HerdrSlot = Arc<RwLock<Option<Herdr>>>;

/// Ties a spawned task to its owner: dropping (or cancelling) the owner stops the task.
struct AbortOnDrop<T>(JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
    #[error(transparent)]
    Relay(#[from] RelayError),
    /// The herdr state loop ended, which only a bug can cause; state would never be reported again.
    #[error("the herdr state loop stopped unexpectedly")]
    StateLoopStopped,
}

/// Runs until another gateway takes over this machine, the relay URL / origin is unusable, or the
/// state loop dies.
pub async fn run(opts: GatewayOptions) -> Result<(), GatewayError> {
    let slot: HerdrSlot = Arc::default();
    let (states, states_rx) = watch::channel(None);
    let (refresh, refresh_rx) = mpsc::channel(1);
    let path = std::env::var_os("PATH");
    let caps = Caps { methods: calls::methods(), agent_kinds: state::agent_kinds(path.as_deref()) };
    let reporter = Reporter { machine: opts.machine.clone(), caps, boot: now_ms() };
    let monitor = monitor::run(reporter, Arc::clone(&slot), states, refresh.clone(), refresh_rx);
    let mut monitor = AbortOnDrop(tokio::spawn(monitor));
    let (calls, frames) = Calls::new(slot, refresh);
    tokio::select! {
        result = uplink::run(&opts, calls, Outbox::new(frames), states_rx) => Ok(result?),
        joined = &mut monitor.0 => {
            if let Err(err) = joined {
                tracing::error!(%err, "herdr monitor failed");
            }
            Err(GatewayError::StateLoopStopped)
        }
    }
}

/// Asks the monitor to publish the current state soon; one pending request is enough.
fn nudge(refresh: &mpsc::Sender<()>) {
    if refresh.try_send(()).is_err() {
        tracing::trace!("refresh already pending");
    }
}
