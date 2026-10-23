//! The gateway's connection to the relay: reconnects with backoff, reports state on every change,
//! and passes frames between the relay and the calls in flight.

use std::time::Duration;

use isbell_proto::frame::{Frame, Header, Route};
use isbell_proto::state::MachineState;
use tokio::sync::{mpsc, watch};

use super::GatewayOptions;
use super::calls::ToCalls;
use super::link::Link;
use crate::relay::{self, RELAY_IDLE, RelayConn, RelayError};

const BACKOFF: &[u64] = &[1, 2, 5, 10, 30];

/// Frames produced by calls, drained by whichever relay connection is current.
struct Outbox {
    rx: mpsc::UnboundedReceiver<Frame>,
    /// A frame whose send failed on a dying connection, sent first on the next one.
    retry: Option<Frame>,
}

impl Outbox {
    async fn next(&mut self) -> Option<Frame> {
        match self.retry.take() {
            Some(frame) => Some(frame),
            None => self.rx.recv().await,
        }
    }
}

/// Runs until the relay refuses this gateway for good (taken over, unusable URL or origin).
pub async fn run(
    opts: &GatewayOptions,
    calls: mpsc::UnboundedSender<ToCalls>,
    states: watch::Receiver<Option<MachineState>>,
) -> Result<(), RelayError> {
    // Every relay link's replies go to `out`, drained by whichever relay connection is current.
    let (out, rx) = mpsc::unbounded_channel();
    let mut outbox = Outbox { rx, retry: None };
    let mut attempt = 0;
    loop {
        let served =
            match relay::connect(&opts.relay, &opts.identity, Some(opts.machine.clone())).await {
                Ok(conn) => {
                    tracing::info!(relay = %opts.relay, "connected to relay");
                    attempt = 0;
                    serve(conn, &calls, &out, &mut outbox, states.clone()).await
                }
                Err(err) => Err(err),
            };
        match served {
            Err(err) if is_fatal(&err) => return Err(err),
            Err(err) => tracing::warn!(%err, "relay connection lost"),
            Ok(()) => {}
        }
        tokio::time::sleep(backoff(attempt)).await;
        attempt += 1;
    }
}

fn is_fatal(err: &RelayError) -> bool {
    matches!(err, RelayError::Replaced | RelayError::OriginMismatch { .. } | RelayError::Url(_))
}

fn backoff(attempt: usize) -> Duration {
    Duration::from_secs(BACKOFF[attempt.min(BACKOFF.len() - 1)])
}

/// The caller of a relayed frame, and the frame without routing fields. The relay always sets
/// `from` on frames from clients.
fn from_relay(frame: Frame, out: &mpsc::UnboundedSender<Frame>) -> Option<(Link, Frame)> {
    let Some(Route { from: Some(conn), .. }) = frame.header.route() else {
        tracing::debug!("ignoring a relayed frame without a caller");
        return None;
    };
    Some((Link::relay(conn, out.clone()), frame.rerouted(Route::default())))
}

/// Serves one relay connection until it fails.
async fn serve(
    conn: RelayConn,
    calls: &mpsc::UnboundedSender<ToCalls>,
    out: &mpsc::UnboundedSender<Frame>,
    outbox: &mut Outbox,
    mut states: watch::Receiver<Option<MachineState>>,
) -> Result<(), RelayError> {
    let (mut sink, mut stream) = (conn.sink, conn.stream);
    // Every new connection starts with the current state.
    states.mark_changed();
    loop {
        tokio::select! {
            frame = stream.next(RELAY_IDLE) => {
                if let Some((link, frame)) = from_relay(frame?, out)
                    && calls.send(ToCalls::Frame(link, Box::new(frame))).is_err()
                {
                    tracing::error!("the calls stopped; dropping a relayed frame");
                }
            }
            Some(frame) = outbox.next() => {
                if let Err(err) = sink.send(&frame).await {
                    outbox.retry = Some(frame);
                    return Err(err);
                }
            }
            changed = states.changed() => {
                if changed.is_err() {
                    return Ok(());
                }
                let Some(state) = states.borrow_and_update().clone() else { continue };
                let state = serde_json::to_value(&state).expect("state serializes");
                sink.send(&Frame::new(Header::State { state })).await?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_refusal_for_good_stops_reconnecting() {
        assert!(is_fatal(&RelayError::Replaced));
        assert!(is_fatal(&RelayError::Url("x".into())));
        assert!(!is_fatal(&RelayError::Idle));
        assert!(!is_fatal(&RelayError::Closed(Some(1011))));
    }

    #[test]
    fn relayed_frames_lose_their_route_and_name_their_caller() {
        let (out, mut rx) = mpsc::unbounded_channel();
        let end = |from: Option<&str>| {
            let from = from.map(str::to_owned);
            Frame::new(Header::End { id: 7, e: None, mid: None, from, to: None })
        };
        let (link, frame) = from_relay(end(Some("c1")), &out).unwrap();
        assert_eq!(link.key(), "c1");
        assert_eq!(frame.header.route(), Some(Route::default()));
        link.send(frame);
        assert_eq!(rx.try_recv().unwrap().header.route().unwrap().to.as_deref(), Some("c1"));
        assert!(from_relay(end(None), &out).is_none(), "the relay always names the caller");
    }

    #[test]
    fn backoff_grows_then_stays_at_its_cap() {
        let delays: Vec<u64> = (0..7).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(delays, [1, 2, 5, 10, 30, 30, 30]);
    }
}
