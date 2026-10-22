//! Terminal sessions: `herdr terminal session observe|control` as a child process. Opening one
//! validates the request, creates a shell workspace for `new`, and waits for herdr's first frame.

mod frames;
mod pump;

use std::process::Stdio;
use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};

use self::frames::{Event, parse_line};
pub use self::frames::{Input, Output};
pub use self::pump::pump;
use super::herdr::Herdr;
use super::workspace;

pub const MAX_TERMINALS: usize = 8;
const FIRST_FRAME_WITHIN: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Observe,
    Control,
}

#[derive(Debug, Deserialize)]
pub struct TerminalRequest {
    target: Option<String>,
    new: Option<NewShell>,
    mode: Mode,
    cols: u16,
    rows: u16,
    #[serde(default)]
    takeover: bool,
}

#[derive(Debug, Deserialize)]
struct NewShell {
    cwd: String,
}

pub struct Session {
    _child: Child,
    stdin: Option<ChildStdin>,
    stdout: Lines<BufReader<ChildStdout>>,
    first: Event,
}

fn bad_request(msg: impl Into<String>) -> RpcError {
    RpcError::new("bad_request", msg)
}

fn herdr_error(msg: impl Into<String>) -> RpcError {
    RpcError::new("herdr_error", msg)
}

/// Starts the session (creating a shell workspace first for `new`) and waits for its first frame,
/// so a bad target fails the open instead of a stream that ends at once.
pub async fn open(herdr: &Herdr, req: TerminalRequest) -> Result<(Session, Value), RpcError> {
    if req.cols == 0 || req.rows == 0 {
        return Err(bad_request("cols and rows must be positive"));
    }
    let created = match (&req.target, &req.new) {
        (Some(_), None) => None,
        (None, Some(_)) if req.mode == Mode::Observe => {
            return Err(bad_request("a new shell needs control mode"));
        }
        (None, Some(new)) => Some(new_shell(herdr, &new.cwd).await?),
        _ => return Err(bad_request("give exactly one of target or new")),
    };
    let target = created.as_deref().or(req.target.as_deref()).expect("target or new shell");
    let started = start_session(herdr, target, &req).await;
    if let (Err(_), Some(pane)) = (&started, &created) {
        workspace::close_pane(herdr, pane, "terminal attach").await;
    }
    started.map(|session| (session, json!({"paneId": created})))
}

async fn new_shell(herdr: &Herdr, cwd: &str) -> Result<String, RpcError> {
    let cwd = workspace::resolve_cwd(cwd)?;
    workspace::create(herdr, &cwd, &format!("shell-{}", workspace::dir_name(&cwd))).await
}

async fn start_session(
    herdr: &Herdr,
    target: &str,
    req: &TerminalRequest,
) -> Result<Session, RpcError> {
    let mut child = session_command(herdr, target, req)
        .spawn()
        .map_err(|err| RpcError::new("herdr_unavailable", format!("cannot run herdr: {err}")))?;
    let stdin = child.stdin.take();
    let mut stdout = BufReader::new(child.stdout.take().expect("piped")).lines();
    let mut stderr = child.stderr.take().expect("piped");
    let first = first_event(&mut stdout, &mut stderr).await?;
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!(line, "herdr terminal session");
        }
    });
    Ok(Session { _child: child, stdin, stdout, first })
}

/// `herdr terminal session …` for `req`; only control sessions take input on stdin.
fn session_command(herdr: &Herdr, target: &str, req: &TerminalRequest) -> tokio::process::Command {
    let control = req.mode == Mode::Control;
    let mode = if control { "control" } else { "observe" };
    let (cols, rows) = (req.cols.to_string(), req.rows.to_string());
    let mut cmd = herdr.command();
    cmd.args(["terminal", "session", mode, target, "--cols", &cols, "--rows", &rows])
        .args((control && req.takeover).then_some("--takeover"))
        .stdin(if control { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    cmd
}

async fn first_event(
    stdout: &mut Lines<BufReader<ChildStdout>>,
    stderr: &mut ChildStderr,
) -> Result<Event, RpcError> {
    match tokio::time::timeout(FIRST_FRAME_WITHIN, stdout.next_line()).await {
        Ok(Ok(Some(line))) => parse_line(&line).map_err(herdr_error),
        Ok(Ok(None)) => {
            let mut message = String::new();
            if let Err(err) = stderr.read_to_string(&mut message).await {
                tracing::debug!(%err, "cannot read herdr stderr");
            }
            Err(RpcError::new("terminal_failed", message.trim()))
        }
        Ok(Err(err)) => Err(herdr_error(format!("cannot read herdr output: {err}"))),
        Err(_) => Err(RpcError::new("timeout", "herdr sent no terminal frame")),
    }
}
