//! A running session: herdr's output coalesced into the stream as the client grants credit, client
//! input written back, until either side ends it or the client goes silent or too far behind.

use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::frames::{Coalescer, Command, Event, command, read_event, release_command};
use super::{Session, herdr_error};
use crate::gateway::stream::{Input, Output};

/// The client pings every 15s; a stream silent for longer has lost its client.
const CLIENT_IDLE: Duration = Duration::from_secs(45);
const IDLE_CHECK_EVERY: Duration = Duration::from_secs(5);
const RELEASE_GRACE: Duration = Duration::from_secs(1);

/// Runs the session until herdr closes it, the client closes or goes silent, or I/O fails;
/// `emit` delivers the stream's output.
pub async fn pump(
    mut session: Session,
    mut input: mpsc::Receiver<Input>,
    mut emit: impl FnMut(Output),
) {
    let first = std::mem::replace(&mut session.first, Event::Closed);
    let Some(mut out) = on_herdr(Coalescer::default(), Ok(first), &mut emit) else { return };
    let mut last_client = Instant::now();
    let mut idle_check = tokio::time::interval(IDLE_CHECK_EVERY);
    loop {
        tokio::select! {
            line = session.stdout.next_line() => match on_herdr(out, read_event(line), &mut emit) {
                Some(next) => out = next,
                None => return,
            },
            () = sleep_until(out.deadline()), if out.deadline().is_some() => {
                let (next, output) = out.flush();
                output.into_iter().for_each(&mut emit);
                out = next;
            }
            msg = input.recv() => {
                last_client = Instant::now();
                match command(msg.unwrap_or(Input::Close)) {
                    Command::Write(line) => if let Err(err) = write_line(&mut session, &line).await {
                        return end(out, Some(herdr_error(err.to_string())), &mut emit);
                    },
                    Command::Release => return release(session).await,
                    Command::Grant(n) => out = out.grant(n),
                    Command::Nothing => {}
                }
            }
            _ = idle_check.tick() => if last_client.elapsed() > CLIENT_IDLE {
                tracing::info!("terminal client went silent; closing the session");
                return emit(Output::End(Some(RpcError::new("idle", "no client activity"))));
            }
        }
    }
}

/// Coalesces one event from herdr; `None` once the stream has ended.
fn on_herdr(
    out: Coalescer,
    event: Result<Event, String>,
    emit: &mut impl FnMut(Output),
) -> Option<Coalescer> {
    let event = match event {
        Ok(event) => event,
        Err(err) => {
            end(out, Some(herdr_error(err)), emit);
            return None;
        }
    };
    let (next, output, ended) = out.push(event, Instant::now());
    output.into_iter().for_each(emit);
    (!ended).then_some(next)
}

/// Sends pending output, then ends the stream.
fn end(out: Coalescer, err: Option<RpcError>, emit: &mut impl FnMut(Output)) {
    let (_, output) = out.flush();
    output.into_iter().chain([Output::End(err)]).for_each(emit);
}

async fn sleep_until(deadline: Option<Instant>) {
    tokio::time::sleep_until(deadline.expect("guarded by is_some")).await;
}

/// Writes one NDJSON line; observe sessions have no stdin and ignore input.
async fn write_line(session: &mut Session, line: &Value) -> std::io::Result<()> {
    let Some(stdin) = session.stdin.as_mut() else {
        return Ok(());
    };
    stdin.write_all(format!("{line}\n").as_bytes()).await
}

/// Gives control back to herdr before the child is dropped (and killed).
async fn release(mut session: Session) {
    if session.stdin.is_none() {
        return;
    }
    if let Err(err) = write_line(&mut session, &release_command()).await {
        tracing::debug!(%err, "terminal release not delivered");
        return;
    }
    // Let herdr finish the release; the child is killed on drop either way.
    let drained = async { while let Ok(Some(_)) = session.stdout.next_line().await {} };
    if tokio::time::timeout(RELEASE_GRACE, drained).await.is_err() {
        tracing::debug!("herdr kept the terminal session open after release");
    }
}
