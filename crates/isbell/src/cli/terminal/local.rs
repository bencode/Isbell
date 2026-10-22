//! The local terminal: its size, raw mode on the alternate screen, keystrokes, and resizes.

use std::io::Read;

use crossterm::terminal::{EnterAlternateScreen, LeaveAlternateScreen};
use tokio::signal::unix::{Signal, SignalKind, signal};
use tokio::sync::mpsc;

use crate::cli::output::CliError;

/// The local terminal size; some terminals report 0×0, so fall back to 80×24.
pub fn terminal_size() -> Result<(u16, u16), CliError> {
    let (cols, rows) = crossterm::terminal::size()
        .map_err(|err| CliError::new("not_a_terminal", err.to_string()))?;
    Ok(if cols == 0 || rows == 0 { (80, 24) } else { (cols, rows) })
}

/// Raw mode on the alternate screen, restored on drop (including on errors).
pub struct Screen;

impl Screen {
    pub fn enter() -> Result<Screen, CliError> {
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

/// Resize notifications; `None`, with a warning, when the platform cannot provide them.
pub fn watch_resizes() -> Option<Signal> {
    signal(SignalKind::window_change())
        .inspect_err(|err| tracing::warn!(%err, "cannot watch for terminal resizes"))
        .ok()
}

pub async fn recv_resize(resized: &mut Option<Signal>) -> Option<()> {
    match resized {
        Some(signal) => signal.recv().await,
        None => std::future::pending().await,
    }
}

/// Keystrokes from a plain thread: a blocking read must not keep the runtime from exiting.
/// A read error is passed on, not logged, since logs are invisible on the alternate screen.
pub fn read_stdin() -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (tx, rx) = mpsc::channel(64);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 4096];
        loop {
            let read = match stdin.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => Ok(buf[..n].to_vec()),
                Err(err) => Err(err),
            };
            let failed = read.is_err();
            if tx.blocking_send(read).is_err() || failed {
                return;
            }
        }
    });
    rx
}
