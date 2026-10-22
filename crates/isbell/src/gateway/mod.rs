//! `isbell gateway run`: keeps this machine's herdr state reported to the relay and serves requests.

pub mod herdr;
pub mod rpc;
pub mod state;

use std::sync::{Arc, RwLock};
use std::time::Duration;

use isbell_proto::frame::{Frame, Header, MachineInfo};
use isbell_proto::identity::Identity;
use isbell_proto::state::{Caps, HerdrState, MachineState};
use serde_json::json;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use self::herdr::Herdr;
use self::state::{StateTracker, derive_agents, now_ms, snapshot_agents};
use crate::relay::{self, FrameSink, FrameStream, RelayError};

const BACKOFF: &[u64] = &[1, 2, 5, 10, 30];
const RELAY_IDLE: Duration = Duration::from_secs(45);
const POLL_EVERY: Duration = Duration::from_secs(10);
const DEBOUNCE: Duration = Duration::from_millis(150);
const REDISCOVER_EVERY: Duration = Duration::from_secs(5);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct GatewayOptions {
    pub relay: String,
    pub identity: Identity,
    pub machine: MachineInfo,
}

/// Shared between the state loop (which discovers herdr) and request handlers.
type HerdrSlot = Arc<RwLock<Option<Herdr>>>;

/// Ties a spawned task to its owner: dropping (or cancelling) the owner stops the task.
struct AbortOnDrop<T>(JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Runs until the relay reports that another gateway took over this machine.
pub async fn run(opts: GatewayOptions) -> anyhow::Result<()> {
    let slot: HerdrSlot = Arc::default();
    let (state_tx, state_rx) = watch::channel(None);
    let (refresh_tx, refresh_rx) = mpsc::channel(1);
    let caps = Caps {
        methods: rpc::methods(),
        agent_kinds: state::agent_kinds(),
    };
    let tracker = StateTracker::new(opts.machine.clone(), caps);
    let _state_task = AbortOnDrop(tokio::spawn(state_loop(
        tracker,
        Arc::clone(&slot),
        state_tx,
        refresh_tx.clone(),
        refresh_rx,
    )));
    relay_loop(&opts, &slot, state_rx, refresh_tx).await
}

// ---------- herdr side ----------

async fn state_loop(
    mut tracker: StateTracker,
    slot: HerdrSlot,
    state_tx: watch::Sender<Option<MachineState>>,
    refresh_tx: mpsc::Sender<()>,
    mut refresh_rx: mpsc::Receiver<()>,
) {
    loop {
        match herdr::discover().await {
            Ok((herdr, herdr_state)) => {
                *slot.write().expect("herdr slot poisoned") = Some(herdr.clone());
                tracing::info!(version = ?herdr_state.version, "herdr connected");
                let err = follow(
                    &herdr,
                    herdr_state,
                    &mut tracker,
                    &state_tx,
                    &refresh_tx,
                    &mut refresh_rx,
                )
                .await;
                tracing::warn!(%err, "lost herdr");
                *slot.write().expect("herdr slot poisoned") = None;
            }
            Err(herdr_state) => {
                if let Some(state) = tracker.update(herdr_state, Vec::new()) {
                    tracing::warn!(status = ?state.herdr.status, "herdr not available");
                    state_tx.send_replace(Some(state.clone()));
                }
                tokio::time::sleep(REDISCOVER_EVERY).await;
            }
        }
    }
}

/// Publishes state on herdr events (debounced) and every poll interval, until herdr fails.
async fn follow(
    herdr: &Herdr,
    herdr_state: HerdrState,
    tracker: &mut StateTracker,
    state_tx: &watch::Sender<Option<MachineState>>,
    refresh_tx: &mpsc::Sender<()>,
    refresh_rx: &mut mpsc::Receiver<()>,
) -> herdr::HerdrError {
    let mut watcher: Option<(Vec<String>, AbortOnDrop<()>)> = None;
    let mut poll = tokio::time::interval(POLL_EVERY);
    loop {
        let result = match herdr
            .request("session.snapshot", json!({}), Some(SNAPSHOT_TIMEOUT))
            .await
        {
            Ok(result) => result,
            Err(err) => break err,
        };
        let infos = match snapshot_agents(&result) {
            Ok(infos) => infos,
            Err(err) => {
                break herdr::HerdrError {
                    code: "herdr_error".into(),
                    message: err.to_string(),
                };
            }
        };
        let agents = derive_agents(infos, tracker.agents(), now_ms());
        let panes: Vec<String> = agents.iter().map(|a| a.pane_id.clone()).collect();
        if let Some(state) = tracker.update(herdr_state.clone(), agents) {
            state_tx.send_replace(Some(state.clone()));
        }
        let stale = watcher
            .as_ref()
            .is_none_or(|(watched, task)| *watched != panes || task.0.is_finished());
        if stale {
            let task = spawn_watcher(herdr.clone(), panes.clone(), refresh_tx.clone());
            watcher = Some((panes, AbortOnDrop(task)));
        }
        tokio::select! {
            _ = poll.tick() => {}
            Some(()) = refresh_rx.recv() => {
                tokio::time::sleep(DEBOUNCE).await;
                while refresh_rx.try_recv().is_ok() {}
            }
        }
    }
}

/// Events only trigger a refresh; when the subscription ends, the next refresh resubscribes.
fn spawn_watcher(herdr: Herdr, panes: Vec<String>, refresh: mpsc::Sender<()>) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(err) = herdr.watch(&panes, &refresh).await {
            tracing::debug!(%err, "herdr subscription ended");
            // Avoid a tight resubscribe loop when herdr rejects the subscription.
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if refresh.try_send(()).is_err() {
            tracing::trace!("refresh already pending");
        }
    })
}

// ---------- relay side ----------

async fn relay_loop(
    opts: &GatewayOptions,
    slot: &HerdrSlot,
    state_rx: watch::Receiver<Option<MachineState>>,
    refresh_tx: mpsc::Sender<()>,
) -> anyhow::Result<()> {
    let mut attempt = 0;
    loop {
        let result =
            match relay::connect(&opts.relay, &opts.identity, Some(opts.machine.clone())).await {
                Ok(conn) => {
                    tracing::info!(relay = %opts.relay, "connected to relay");
                    attempt = 0;
                    serve(conn.sink, conn.stream, slot, state_rx.clone(), &refresh_tx).await
                }
                Err(err) => Err(err),
            };
        match result {
            Err(RelayError::Replaced) => return Err(RelayError::Replaced.into()),
            Err(err @ (RelayError::OriginMismatch { .. } | RelayError::Url(_))) => {
                return Err(err.into());
            }
            Err(err) => tracing::warn!(%err, "relay connection lost"),
            Ok(()) => {}
        }
        let delay = BACKOFF[attempt.min(BACKOFF.len() - 1)];
        attempt += 1;
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

async fn serve(
    mut sink: FrameSink,
    mut stream: FrameStream,
    slot: &HerdrSlot,
    mut state_rx: watch::Receiver<Option<MachineState>>,
    refresh_tx: &mpsc::Sender<()>,
) -> Result<(), RelayError> {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();
    let writer = AbortOnDrop(tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            sink.send(&frame).await?;
        }
        Ok::<_, RelayError>(())
    }));
    let states_out = out_tx.clone();
    let _states = AbortOnDrop(tokio::spawn(async move {
        state_rx.mark_changed();
        while state_rx.changed().await.is_ok() {
            let Some(state) = state_rx.borrow_and_update().clone() else {
                continue;
            };
            let state = serde_json::to_value(&state).expect("state serializes");
            if states_out
                .send(Frame::new(Header::State { state }))
                .is_err()
            {
                break;
            }
        }
    }));

    loop {
        let frame = stream.next(RELAY_IDLE).await?;
        let Header::Call {
            id,
            m,
            p,
            from: Some(from),
            ..
        } = frame.header
        else {
            tracing::debug!("ignoring unexpected frame from relay");
            continue;
        };
        let herdr = slot.read().expect("herdr slot poisoned").clone();
        let out = out_tx.clone();
        let refresh = refresh_tx.clone();
        tokio::spawn(async move {
            let result = rpc::handle(herdr, &m, p).await;
            if m == rpc::START_AGENT && refresh.try_send(()).is_err() {
                tracing::trace!("refresh already pending");
            }
            let (ok, r, e) = match result {
                Ok(r) => (true, Some(r), None),
                Err(e) => (false, None, Some(e)),
            };
            let res = Header::Res {
                id,
                ok,
                r,
                e,
                mid: None,
                to: Some(from),
            };
            if out.send(Frame::new(res)).is_err() {
                tracing::debug!(id, "relay connection closed before the response");
            }
        });
        if writer.0.is_finished() {
            return Err(RelayError::Closed(None));
        }
    }
}
