//! `isbell terminal attach | new`: a remote herdr pane in this terminal (raw mode, alternate
//! screen). `ctrl+]` detaches.

mod local;

use std::io::{IsTerminal, Write};
use std::time::Duration;

use clap::Subcommand;
use isbell_proto::frame::RpcError;
use serde_json::{Value, json};
use tokio::signal::unix::Signal;

use self::local::{Screen, read_stdin, recv_resize, terminal_size, watch_resizes};
use super::Ctx;
use super::output::CliError;
use super::target::{parse_target, resolve_machine};
use crate::client::{Stream, StreamEvent};

const DETACH: u8 = 0x1d; // ctrl+]
const PING_EVERY: Duration = Duration::from_secs(15);
/// The gateway may take 30s to create a shell workspace plus 10s for herdr's first frame.
const OPEN_TIMEOUT: Duration = Duration::from_secs(50);

#[derive(Subcommand)]
pub enum TerminalCmd {
    /// Attach to a pane or agent; read-only unless --control. Detach with ctrl+].
    Attach {
        target: String,
        /// Type into the pane (one controller at a time).
        #[arg(long)]
        control: bool,
        /// Take control from the current controller.
        #[arg(long, requires = "control")]
        takeover: bool,
    },
    /// Open a new shell in a new workspace and attach to it. Quote `~` paths so they expand remotely.
    New {
        machine: String,
        #[arg(long)]
        cwd: String,
    },
}

pub async fn run(ctx: &Ctx, cmd: TerminalCmd) -> Result<(), CliError> {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        let message = "terminal commands need an interactive terminal";
        return Err(CliError::new("not_a_terminal", message));
    }
    let (cols, rows) = terminal_size()?;
    let (machine, control, params) = open_params(cmd, cols, rows)?;
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, &machine)?;
    let (opened, stream) =
        session.open_stream(&state.machine.id, "isbell.terminal", params, OPEN_TIMEOUT).await?;
    // A new shell outlives the detach; say how to come back to it.
    let reattach = opened["paneId"].as_str().map(|pane| format!("{}/{pane}", state.machine.name));

    // Set up before the alternate screen so a warning here stays visible.
    let resized = watch_resizes();
    let ended = {
        let _screen = Screen::enter()?;
        attached(stream, control, resized).await
    };
    println!("{}", outcome(ended, reattach)?);
    Ok(())
}

/// The machine to open the terminal on, whether it takes input, and the `isbell.terminal` params.
fn open_params(cmd: TerminalCmd, cols: u16, rows: u16) -> Result<(String, bool, Value), CliError> {
    match cmd {
        TerminalCmd::Attach { target, control, takeover } => {
            let target = parse_target(&target)?;
            let mode = if control { "control" } else { "observe" };
            let params = json!({"target": target.agent, "mode": mode, "cols": cols, "rows": rows, "takeover": takeover});
            Ok((target.machine.to_owned(), control, params))
        }
        TerminalCmd::New { machine, cwd } => {
            let params =
                json!({"new": {"cwd": cwd}, "mode": "control", "cols": cols, "rows": rows});
            Ok((machine, true, params))
        }
    }
}

enum Ended {
    Detached,
    Closed(Option<RpcError>),
    /// Local terminal I/O failed; reported once the alternate screen is gone.
    Failed(std::io::Error),
}

/// What to tell the user once the alternate screen is gone, or the error to exit with.
fn outcome(ended: Ended, reattach: Option<String>) -> Result<String, CliError> {
    match (ended, reattach) {
        (Ended::Detached, Some(target)) => {
            Ok(format!("detached; reattach with: isbell terminal attach {target} --control"))
        }
        (Ended::Detached, None) => Ok("detached".into()),
        (Ended::Closed(None), _) => Ok("terminal closed".into()),
        (Ended::Closed(Some(err)), _) => Err(err.into()),
        (Ended::Failed(err), _) => Err(CliError::new("terminal_error", err.to_string())),
    }
}

async fn attached(mut stream: Stream, control: bool, mut resized: Option<Signal>) -> Ended {
    let mut keys = read_stdin();
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut stdout = std::io::stdout();
    loop {
        tokio::select! {
            event = stream.next() => match event {
                StreamEvent::Frame { body, .. } => {
                    if let Err(err) = stdout.write_all(&body).and_then(|()| stdout.flush()) {
                        return Ended::Failed(err);
                    }
                }
                // A terminal stream carries no file chunks or credit.
                StreamEvent::Chunk(_) | StreamEvent::Credit(_) => {}
                StreamEvent::End(err) => return Ended::Closed(err),
            },
            bytes = keys.recv() => {
                let bytes = match bytes {
                    Some(Ok(bytes)) => bytes,
                    Some(Err(err)) => return Ended::Failed(err),
                    None => return Ended::Detached,
                };
                if let Some(at) = bytes.iter().position(|b| *b == DETACH) {
                    if control && at > 0 {
                        stream.input(bytes[..at].to_vec());
                    }
                    return Ended::Detached;
                }
                if control {
                    stream.input(bytes);
                }
            }
            Some(()) = recv_resize(&mut resized) => {
                if control && let Ok((cols, rows)) = terminal_size() {
                    stream.resize(cols, rows);
                }
            }
            _ = ping.tick() => stream.ping(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attach(control: bool, takeover: bool) -> TerminalCmd {
        TerminalCmd::Attach { target: "mac/w1:p1".into(), control, takeover }
    }

    #[test]
    fn builds_open_params() {
        let (machine, control, params) = open_params(attach(false, false), 80, 24).unwrap();
        assert_eq!((machine.as_str(), control), ("mac", false));
        assert_eq!(
            params,
            json!({"target": "w1:p1", "mode": "observe", "cols": 80, "rows": 24, "takeover": false})
        );
        let (_, control, params) = open_params(attach(true, true), 80, 24).unwrap();
        assert!(control);
        assert_eq!((&params["mode"], &params["takeover"]), (&json!("control"), &json!(true)));
        let new = TerminalCmd::New { machine: "mac".into(), cwd: "~/src".into() };
        let (_, control, params) = open_params(new, 100, 30).unwrap();
        assert!(control);
        assert_eq!(
            params,
            json!({"new": {"cwd": "~/src"}, "mode": "control", "cols": 100, "rows": 30})
        );
        assert_eq!(
            open_params(
                TerminalCmd::Attach { target: "mac".into(), control: false, takeover: false },
                80,
                24
            )
            .unwrap_err()
            .code,
            "bad_target"
        );
    }

    #[test]
    fn tells_how_to_reattach_a_new_shell() {
        let reattach = Some("mac/w9:p1".to_owned());
        assert_eq!(
            outcome(Ended::Detached, reattach).unwrap(),
            "detached; reattach with: isbell terminal attach mac/w9:p1 --control"
        );
        assert_eq!(outcome(Ended::Detached, None).unwrap(), "detached");
        assert_eq!(outcome(Ended::Closed(None), None).unwrap(), "terminal closed");
        assert_eq!(
            outcome(Ended::Closed(Some(RpcError::new("idle", "x"))), None).unwrap_err().code,
            "idle"
        );
    }
}
