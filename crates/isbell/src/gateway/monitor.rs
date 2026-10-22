//! Follows the local herdr server and publishes this machine's state whenever it changes. The watch
//! channel holds the last state published; a new one is published only when it differs.

use std::time::Duration;

use isbell_proto::state::{Agent, HerdrState, MachineState};
use serde_json::json;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::Interval;

use super::herdr::{self, Herdr, HerdrError};
use super::state::{Reporter, derive_agents, next_state, snapshot_agents};
use super::{AbortOnDrop, HerdrSlot, nudge};
use crate::now_ms;

const POLL_EVERY: Duration = Duration::from_secs(10);
const DEBOUNCE: Duration = Duration::from_millis(150);
const REDISCOVER_EVERY: Duration = Duration::from_secs(5);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);
/// Pause before resubscribing after herdr rejected or broke a subscription.
const RESUBSCRIBE_PAUSE: Duration = Duration::from_secs(1);

type States = watch::Sender<Option<MachineState>>;

/// Runs forever: (re)discovers herdr, then follows it until it fails. A refresh request (herdr
/// events, a started agent) publishes the current state early.
pub async fn run(
    reporter: Reporter,
    slot: HerdrSlot,
    states: States,
    refresh: mpsc::Sender<()>,
    mut refresh_rx: mpsc::Receiver<()>,
) {
    loop {
        match herdr::discover().await {
            Ok((herdr, herdr_state)) => {
                *slot.write().expect("herdr slot poisoned") = Some(herdr.clone());
                tracing::info!(version = ?herdr_state.version, "herdr connected");
                let followed =
                    Following { herdr: &herdr, herdr_state, reporter: &reporter, states: &states };
                let err = followed.run(&refresh, &mut refresh_rx).await;
                tracing::warn!(%err, "lost herdr");
                *slot.write().expect("herdr slot poisoned") = None;
            }
            Err(herdr_state) => {
                if publish(&reporter, &states, herdr_state.clone(), Vec::new()) {
                    tracing::warn!(status = ?herdr_state.status, "herdr not available");
                }
            }
        }
        // Also after losing herdr: it may still report itself running while not answering.
        tokio::time::sleep(REDISCOVER_EVERY).await;
    }
}

/// Publishes the state for `herdr_state` and `agents` if it changed; true when it did.
fn publish(
    reporter: &Reporter,
    states: &States,
    herdr_state: HerdrState,
    agents: Vec<Agent>,
) -> bool {
    states.send_if_modified(|current| {
        match next_state(reporter, current.as_ref(), herdr_state, agents) {
            Some(state) => {
                *current = Some(state);
                true
            }
            None => false,
        }
    })
}

/// A herdr server being followed.
struct Following<'a> {
    herdr: &'a Herdr,
    herdr_state: HerdrState,
    reporter: &'a Reporter,
    states: &'a States,
}

impl Following<'_> {
    /// Publishes state on herdr events (debounced) and every poll interval, until herdr fails.
    async fn run(
        self,
        refresh: &mpsc::Sender<()>,
        refresh_rx: &mut mpsc::Receiver<()>,
    ) -> HerdrError {
        let mut watcher: Option<(Vec<String>, AbortOnDrop<()>)> = None;
        let mut poll = tokio::time::interval(POLL_EVERY);
        loop {
            let agents = match self.agents().await {
                Ok(agents) => agents,
                Err(err) => return err,
            };
            let panes: Vec<String> = agents.iter().map(|a| a.pane_id.clone()).collect();
            publish(self.reporter, self.states, self.herdr_state.clone(), agents);
            // A finished watcher has lost its subscription; changed panes need a new one.
            let watching =
                watcher.as_ref().filter(|(_, task)| !task.0.is_finished()).map(|(p, _)| p);
            if watching != Some(&panes) {
                let task = spawn_watcher(self.herdr.clone(), panes.clone(), refresh.clone());
                watcher = Some((panes, AbortOnDrop(task)));
            }
            next_refresh(&mut poll, refresh_rx).await;
        }
    }

    async fn agents(&self) -> Result<Vec<Agent>, HerdrError> {
        let result =
            self.herdr.request("session.snapshot", json!({}), Some(SNAPSHOT_TIMEOUT)).await?;
        let infos = snapshot_agents(&result).map_err(HerdrError::protocol)?;
        let published = self.states.borrow();
        let prev = published.as_ref().map_or(&[][..], |s| &s.agents);
        Ok(derive_agents(infos, prev, now_ms()))
    }
}

/// Requests a refresh for every herdr event; when the subscription ends, the refresh it requests
/// last makes the monitor subscribe again.
fn spawn_watcher(herdr: Herdr, panes: Vec<String>, refresh: mpsc::Sender<()>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let watched = async {
            let mut events = herdr.subscribe(&panes).await?;
            while events.next().await?.is_some() {
                nudge(&refresh);
            }
            Ok::<_, HerdrError>(())
        };
        if let Err(err) = watched.await {
            tracing::debug!(%err, "herdr subscription ended");
            tokio::time::sleep(RESUBSCRIBE_PAUSE).await;
        }
        nudge(&refresh);
    })
}

/// Waits for the next poll tick or refresh request; requests arriving meanwhile are merged.
async fn next_refresh(poll: &mut Interval, refresh_rx: &mut mpsc::Receiver<()>) {
    tokio::select! {
        _ = poll.tick() => {}
        Some(()) = refresh_rx.recv() => {
            tokio::time::sleep(DEBOUNCE).await;
            while refresh_rx.try_recv().is_ok() {}
        }
    }
}
