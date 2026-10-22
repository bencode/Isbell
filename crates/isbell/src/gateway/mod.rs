//! `isbell gateway run`: keeps this machine's herdr state reported to the relay and serves requests.

pub mod herdr;
pub mod rpc;
pub mod state;
pub mod terminal;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineInfo;
use isbell_proto::state::{Caps, HerdrState, MachineState};
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinHandle, JoinSet};

use self::herdr::Herdr;
use self::state::{StateTracker, derive_agents, snapshot_agents};
use self::terminal::{Input, Output};
use crate::now_ms;
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
    let (state_tx, state_rx) = watch::channel(None);
    let (refresh_tx, refresh_rx) = mpsc::channel(1);
    let caps = Caps {
        methods: rpc::methods(),
        agent_kinds: state::agent_kinds(),
    };
    let tracker = StateTracker::new(opts.machine.clone(), caps);
    let mut state_task = AbortOnDrop(tokio::spawn(state_loop(
        tracker,
        Arc::clone(&slot),
        state_tx,
        refresh_tx.clone(),
        refresh_rx,
    )));
    tokio::select! {
        result = relay_loop(&opts, &slot, state_rx, refresh_tx) => Ok(result?),
        joined = &mut state_task.0 => {
            if let Err(err) = joined {
                tracing::error!(%err, "herdr state loop failed");
            }
            Err(GatewayError::StateLoopStopped)
        }
    }
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
                // herdr may still report itself running while not answering; don't spin.
                tokio::time::sleep(REDISCOVER_EVERY).await;
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

/// Responses produced by calls; drained by whichever relay connection is current.
/// Calls belong to the gateway process, not to a connection: a response finished after a
/// reconnect still reaches its caller, because responses are routed by the caller's connection.
struct Outbox {
    rx: mpsc::UnboundedReceiver<Frame>,
    /// A response whose send failed on a dying connection, retried first on the next one.
    retry: Option<Frame>,
}

/// Requests in flight and the channel their responses go to; outlives relay connections.
struct Calls {
    tasks: JoinSet<()>,
    responses: mpsc::UnboundedSender<Frame>,
    /// Open terminal streams by (caller connection, call id), for routing client input.
    streams: Streams,
}

type Streams = Arc<Mutex<HashMap<(String, u64), mpsc::Sender<Input>>>>;

/// Queued client input per stream; keystrokes beyond this are dropped while the session lags.
const STREAM_INPUT_BUFFER: usize = 256;

async fn relay_loop(
    opts: &GatewayOptions,
    slot: &HerdrSlot,
    state_rx: watch::Receiver<Option<MachineState>>,
    refresh_tx: mpsc::Sender<()>,
) -> Result<(), RelayError> {
    let (responses, rx) = mpsc::unbounded_channel();
    let mut outbox = Outbox { rx, retry: None };
    let mut calls = Calls {
        tasks: JoinSet::new(),
        responses,
        streams: Arc::default(),
    };
    let mut attempt = 0;
    loop {
        let result =
            match relay::connect(&opts.relay, &opts.identity, Some(opts.machine.clone())).await {
                Ok(conn) => {
                    tracing::info!(relay = %opts.relay, "connected to relay");
                    attempt = 0;
                    let mut state_rx = state_rx.clone();
                    let (mut sink, mut stream) = (conn.sink, conn.stream);
                    serve(
                        &mut sink,
                        &mut stream,
                        slot,
                        &mut state_rx,
                        &refresh_tx,
                        &mut calls,
                        &mut outbox,
                    )
                    .await
                }
                Err(err) => Err(err),
            };
        match result {
            Err(
                err @ (RelayError::Replaced
                | RelayError::OriginMismatch { .. }
                | RelayError::Url(_)),
            ) => {
                return Err(err);
            }
            Err(err) => tracing::warn!(%err, "relay connection lost"),
            Ok(()) => {}
        }
        let delay = BACKOFF[attempt.min(BACKOFF.len() - 1)];
        attempt += 1;
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

/// Serves one relay connection until it fails.
async fn serve(
    sink: &mut FrameSink,
    stream: &mut FrameStream,
    slot: &HerdrSlot,
    state_rx: &mut watch::Receiver<Option<MachineState>>,
    refresh_tx: &mpsc::Sender<()>,
    calls: &mut Calls,
    outbox: &mut Outbox,
) -> Result<(), RelayError> {
    if let Some(frame) = outbox.retry.take() {
        send_or_keep(sink, frame, outbox).await?;
    }
    // Every new connection starts with the current state.
    state_rx.mark_changed();
    loop {
        while let Some(joined) = calls.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "request task failed");
            }
        }
        tokio::select! {
            frame = stream.next(RELAY_IDLE) => dispatch(frame?, slot, refresh_tx, calls),
            Some(frame) = outbox.rx.recv() => send_or_keep(sink, frame, outbox).await?,
            changed = state_rx.changed() => {
                if changed.is_err() {
                    return Ok(());
                }
                let Some(state) = state_rx.borrow_and_update().clone() else { continue };
                let state = serde_json::to_value(&state).expect("state serializes");
                sink.send(&Frame::new(Header::State { state })).await?;
            }
        }
    }
}

/// Handles one frame from the relay: calls start tasks, stream frames feed open streams.
fn dispatch(frame: Frame, slot: &HerdrSlot, refresh_tx: &mpsc::Sender<()>, calls: &mut Calls) {
    match frame.header {
        Header::Call {
            id,
            m,
            p,
            from: Some(to),
            ..
        } => {
            let herdr = slot.read().expect("herdr slot poisoned").clone();
            let responses = calls.responses.clone();
            if m == rpc::TERMINAL {
                let streams = Arc::clone(&calls.streams);
                calls
                    .tasks
                    .spawn(terminal_stream(herdr, id, to, p, responses, streams));
                return;
            }
            let refresh = refresh_tx.clone();
            calls.tasks.spawn(async move {
                let result = rpc::handle(herdr, &m, p).await;
                if m == rpc::START_AGENT && refresh.try_send(()).is_err() {
                    tracing::trace!("refresh already pending");
                }
                respond(&responses, id, to, result);
            });
        }
        Header::Data {
            id,
            k,
            cols,
            rows,
            from: Some(from),
            ..
        } => {
            let input = match (k, cols, rows) {
                (DataKind::Input, ..) => Input::Bytes(frame.body.unwrap_or_default()),
                (DataKind::Resize, Some(cols @ 1..), Some(rows @ 1..)) => Input::Resize(cols, rows),
                (DataKind::Ping, ..) => Input::Ping,
                (DataKind::Resize | DataKind::Frame, ..) => {
                    return tracing::debug!(
                        id,
                        ?k,
                        "ignoring an invalid stream frame from a client"
                    );
                }
            };
            feed(&calls.streams, from, id, input);
        }
        Header::End {
            id,
            from: Some(from),
            ..
        } => feed(&calls.streams, from, id, Input::Close),
        _ => tracing::debug!("ignoring unexpected frame from relay"),
    }
}

fn respond(
    responses: &mpsc::UnboundedSender<Frame>,
    id: u64,
    to: String,
    result: Result<Value, RpcError>,
) {
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
        to: Some(to),
    };
    if responses.send(Frame::new(res)).is_err() {
        tracing::debug!(id, "gateway stopped before the response");
    }
}

fn feed(streams: &Streams, from: String, id: u64, input: Input) {
    let stream = streams
        .lock()
        .expect("streams poisoned")
        .get(&(from, id))
        .cloned();
    match stream.map(|tx| tx.try_send(input)) {
        Some(Ok(())) => {}
        Some(Err(err)) => tracing::warn!(id, %err, "terminal input dropped"),
        None => tracing::debug!(id, "input for an unknown stream"),
    }
}

/// Opens a terminal session and streams it to the caller until either side ends it.
async fn terminal_stream(
    herdr: Option<Herdr>,
    id: u64,
    to: String,
    p: Value,
    responses: mpsc::UnboundedSender<Frame>,
    streams: Streams,
) {
    let key = (to.clone(), id);
    let (input_tx, input_rx) = mpsc::channel(STREAM_INPUT_BUFFER);
    let opened = async {
        let herdr = herdr
            .ok_or_else(|| RpcError::new("herdr_unavailable", "herdr server is not available"))?;
        let req = serde_json::from_value(p)
            .map_err(|err| RpcError::new("bad_request", err.to_string()))?;
        {
            let mut open = streams.lock().expect("streams poisoned");
            if open.len() >= terminal::MAX_TERMINALS {
                return Err(RpcError::new(
                    "too_many_terminals",
                    "too many open terminals",
                ));
            }
            // Registered before the response so input sent right after it is not lost.
            open.insert(key.clone(), input_tx);
        }
        terminal::open(&herdr, req).await
    };
    let (session, r) = match opened.await {
        Ok(opened) => opened,
        Err(err) => {
            streams.lock().expect("streams poisoned").remove(&key);
            return respond(&responses, id, to, Err(err));
        }
    };
    respond(&responses, id, to.clone(), Ok(r));
    terminal::pump(session, input_rx, |out| {
        let frame = match out {
            Output::Frame {
                body,
                full,
                cols,
                rows,
            } => {
                let header = Header::Data {
                    id,
                    k: DataKind::Frame,
                    full: Some(full),
                    cols: Some(cols),
                    rows: Some(rows),
                    mid: None,
                    from: None,
                    to: Some(to.clone()),
                };
                Frame {
                    header,
                    body: Some(body),
                }
            }
            Output::End(e) => Frame::new(Header::End {
                id,
                e,
                mid: None,
                from: None,
                to: Some(to.clone()),
            }),
        };
        if responses.send(frame).is_err() {
            tracing::debug!(id, "gateway stopped while streaming");
        }
    })
    .await;
    streams.lock().expect("streams poisoned").remove(&key);
}

/// Sends a response, keeping it for the next connection if this one fails.
async fn send_or_keep(
    sink: &mut FrameSink,
    frame: Frame,
    outbox: &mut Outbox,
) -> Result<(), RelayError> {
    let result = sink.send(&frame).await;
    if result.is_err() {
        outbox.retry = Some(frame);
    }
    result
}
