//! `isbell terminal attach | new`: a remote herdr pane in this terminal (raw mode, alternate
//! screen). `ctrl+]` detaches.

use std::io::{IsTerminal, Read, Write};
use std::time::Duration;

use clap::Subcommand;
use crossterm::terminal::{EnterAlternateScreen, LeaveAlternateScreen};
use serde_json::json;
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::mpsc;

use super::Ctx;
use super::output::CliError;
use super::target::{parse_target, resolve_machine};
use crate::client::{Stream, StreamEvent};

const DETACH: u8 = 0x1d; // ctrl+]
const PING_EVERY: Duration = Duration::from_secs(15);
const OPEN_TIMEOUT: Duration = Duration::from_secs(40);

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
        return Err(CliError::new(
            "not_a_terminal",
            "terminal commands need an interactive terminal",
        ));
    }
    let (cols, rows) = terminal_size()?;
    let (machine, control, params) = match cmd {
        TerminalCmd::Attach {
            target,
            control,
            takeover,
        } => {
            let target = parse_target(&target)?;
            let mode = if control { "control" } else { "observe" };
            let params = json!({"target": target.agent, "mode": mode, "cols": cols, "rows": rows, "takeover": takeover});
            (target.machine.to_owned(), control, params)
        }
        TerminalCmd::New { machine, cwd } => (
            machine,
            true,
            json!({"new": {"cwd": cwd}, "mode": "control", "cols": cols, "rows": rows}),
        ),
    };
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, &machine)?;
    let (opened, stream) = session
        .open_stream(&state.machine.id, "isbell.terminal", params, OPEN_TIMEOUT)
        .await?;
    // A new shell outlives the detach; say how to come back to it.
    let reattach = opened["paneId"]
        .as_str()
        .map(|pane| format!("{}/{pane}", state.machine.name));

    let ended = {
        let _screen = Screen::enter()?;
        attached(stream, control).await
    };
    match ended {
        Ended::Detached => match reattach {
            Some(target) => {
                println!("detached; reattach with: isbell terminal attach {target} --control")
            }
            None => println!("detached"),
        },
        Ended::Closed(None) => println!("terminal closed"),
        Ended::Closed(Some(err)) => return Err(err.into()),
    }
    Ok(())
}

/// The local terminal size; some terminals report 0×0, so fall back to 80×24.
fn terminal_size() -> Result<(u16, u16), CliError> {
    let (cols, rows) = crossterm::terminal::size()
        .map_err(|err| CliError::new("not_a_terminal", err.to_string()))?;
    Ok(if cols == 0 || rows == 0 {
        (80, 24)
    } else {
        (cols, rows)
    })
}

enum Ended {
    Detached,
    Closed(Option<isbell_proto::frame::RpcError>),
}

/// Raw mode on the alternate screen, restored on drop (including on errors).
struct Screen;

impl Screen {
    fn enter() -> Result<Screen, CliError> {
        let fail = |err: std::io::Error| CliError::new("not_a_terminal", err.to_string());
        crossterm::terminal::enable_raw_mode().map_err(fail)?;
        let screen = Screen;
        crossterm::execute!(std::io::stdout(), EnterAlternateScreen).map_err(fail)?;
        Ok(screen)
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        if let Err(err) = crossterm::execute!(std::io::stdout(), LeaveAlternateScreen) {
            tracing::warn!(%err, "cannot leave the alternate screen");
        }
        if let Err(err) = crossterm::terminal::disable_raw_mode() {
            tracing::warn!(%err, "cannot restore the terminal mode");
        }
    }
}

async fn attached(mut stream: Stream, control: bool) -> Ended {
    let mut keys = read_stdin();
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut resized = match signal(SignalKind::window_change()) {
        Ok(resized) => Some(resized),
        Err(err) => {
            tracing::warn!(%err, "cannot watch for terminal resizes");
            None
        }
    };
    let mut stdout = std::io::stdout();
    loop {
        tokio::select! {
            event = stream.next() => match event {
                StreamEvent::Frame { body, .. } => {
                    if let Err(err) = stdout.write_all(&body).and_then(|()| stdout.flush()) {
                        tracing::warn!(%err, "cannot write to the terminal");
                        return Ended::Detached;
                    }
                }
                StreamEvent::End(err) => return Ended::Closed(err),
            },
            bytes = keys.recv() => {
                let Some(bytes) = bytes else { return Ended::Detached };
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

async fn recv_resize(resized: &mut Option<tokio::signal::unix::Signal>) -> Option<()> {
    match resized {
        Some(signal) => signal.recv().await,
        None => std::future::pending().await,
    }
}

/// Keystrokes from a plain thread: a blocking read must not keep the runtime from exiting.
fn read_stdin() -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel(64);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 4096];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        return;
                    }
                }
                Err(err) => {
                    tracing::warn!(%err, "cannot read keystrokes");
                    return;
                }
            }
        }
    });
    rx
}
