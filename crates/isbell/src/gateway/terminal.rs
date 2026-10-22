//! Terminal sessions: `herdr terminal session observe|control` as a child process, bridged to a
//! stream. Output frames are coalesced and chunked; control input goes back as herdr's NDJSON.

use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::herdr::Herdr;
use super::rpc::resolve_cwd;

pub const MAX_TERMINALS: usize = 8;
/// Largest data body, so frames also fit a WebRTC DataChannel message.
pub const MAX_CHUNK: usize = 64 * 1024;
const COALESCE_FOR: Duration = Duration::from_millis(50);
const COALESCE_BYTES: usize = 32 * 1024;
/// The client pings every 15s; a stream silent for longer has lost its client.
const CLIENT_IDLE: Duration = Duration::from_secs(45);
const FIRST_FRAME_WITHIN: Duration = Duration::from_secs(10);
const RELEASE_GRACE: Duration = Duration::from_secs(1);

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

/// What a client sends into a stream.
pub enum Input {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Ping,
    Close,
}

/// What a stream sends to its client.
pub enum Output {
    Frame { body: Vec<u8>, full: bool, cols: u16, rows: u16 },
    End(Option<RpcError>),
}

#[derive(Debug, PartialEq)]
enum Event {
    Frame { bytes: Vec<u8>, full: bool, cols: u16, rows: u16 },
    Closed,
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
    match (start_session(herdr, target, &req).await, created) {
        (Ok(session), created) => Ok((session, json!({"paneId": created}))),
        (Err(err), Some(pane)) => {
            // Don't leave behind the shell workspace we just created.
            if let Err(close_err) = herdr
                .request("pane.close", json!({"pane_id": pane}), Some(Duration::from_secs(30)))
                .await
            {
                tracing::warn!(%close_err, pane, "cannot close the new shell after a failed attach");
            }
            Err(err)
        }
        (Err(err), None) => Err(err),
    }
}

async fn start_session(
    herdr: &Herdr,
    target: &str,
    req: &TerminalRequest,
) -> Result<Session, RpcError> {
    let control = req.mode == Mode::Control;
    let mut cmd = herdr.command();
    cmd.args(["terminal", "session", if control { "control" } else { "observe" }, target]);
    cmd.args(["--cols", &req.cols.to_string(), "--rows", &req.rows.to_string()]);
    if control && req.takeover {
        cmd.arg("--takeover");
    }
    let mut child = cmd
        .stdin(if control { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| RpcError::new("herdr_unavailable", format!("cannot run herdr: {err}")))?;
    let stdin = child.stdin.take();
    let mut stdout = BufReader::new(child.stdout.take().expect("piped")).lines();
    let mut stderr = child.stderr.take().expect("piped");

    let first = match tokio::time::timeout(FIRST_FRAME_WITHIN, stdout.next_line()).await {
        Ok(Ok(Some(line))) => parse_line(&line).map_err(|err| RpcError::new("herdr_error", err))?,
        Ok(Ok(None)) => {
            let mut message = String::new();
            if let Err(err) = stderr.read_to_string(&mut message).await {
                tracing::debug!(%err, "cannot read herdr stderr");
            }
            return Err(RpcError::new("terminal_failed", message.trim().to_owned()));
        }
        Ok(Err(err)) => {
            return Err(RpcError::new("herdr_error", format!("cannot read herdr output: {err}")));
        }
        Err(_) => return Err(RpcError::new("timeout", "herdr sent no terminal frame")),
    };
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!(line, "herdr terminal session");
        }
    });
    Ok(Session { _child: child, stdin, stdout, first })
}

async fn new_shell(herdr: &Herdr, cwd: &str) -> Result<String, RpcError> {
    let cwd = resolve_cwd(cwd)?;
    let dir = cwd.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let params = json!({"cwd": cwd, "label": format!("shell-{dir}"), "focus": false, "env": {}});
    let created = herdr.request("workspace.create", params, Some(Duration::from_secs(30))).await?;
    created["root_pane"]["pane_id"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| RpcError::new("herdr_error", "workspace.create returned no root pane"))
}

/// Runs the session until herdr closes it, the client closes or goes silent, or input fails.
pub async fn pump(
    mut session: Session,
    mut input: mpsc::Receiver<Input>,
    mut emit: impl FnMut(Output),
) {
    let mut out = Coalescer::default();
    let mut last_client = Instant::now();
    let mut idle_check = tokio::time::interval(Duration::from_secs(5));
    let first = std::mem::replace(&mut session.first, Event::Closed);
    if out.push(first, &mut emit) {
        return emit(Output::End(None));
    }
    loop {
        tokio::select! {
            line = session.stdout.next_line() => {
                let event = match line {
                    Ok(Some(line)) => parse_line(&line),
                    Ok(None) => Ok(Event::Closed),
                    Err(err) => Err(err.to_string()),
                };
                match event {
                    Ok(event) => {
                        if out.push(event, &mut emit) {
                            return emit(Output::End(None));
                        }
                    }
                    Err(err) => {
                        out.flush(&mut emit);
                        return emit(Output::End(Some(RpcError::new("herdr_error", err))));
                    }
                }
            }
            () = sleep_until(out.deadline), if out.deadline.is_some() => out.flush(&mut emit),
            msg = input.recv() => {
                last_client = Instant::now();
                let command = match msg {
                    Some(Input::Bytes(bytes)) => json!({"type": "terminal.input", "bytes": BASE64.encode(bytes)}),
                    Some(Input::Resize(cols, rows)) => json!({"type": "terminal.resize", "cols": cols, "rows": rows}),
                    Some(Input::Ping) => continue,
                    Some(Input::Close) | None => return release(session).await,
                };
                if let Err(err) = write_command(&mut session, &command).await {
                    out.flush(&mut emit);
                    return emit(Output::End(Some(RpcError::new("herdr_error", err.to_string()))));
                }
            }
            _ = idle_check.tick() => {
                if last_client.elapsed() > CLIENT_IDLE {
                    tracing::info!("terminal client went silent; closing the session");
                    return emit(Output::End(Some(RpcError::new("idle", "no client activity"))));
                }
            }
        }
    }
}

async fn sleep_until(deadline: Option<Instant>) {
    tokio::time::sleep_until(deadline.expect("guarded by is_some")).await;
}

/// Writes one NDJSON command; observe sessions have no stdin and ignore input.
async fn write_command(session: &mut Session, command: &Value) -> std::io::Result<()> {
    let Some(stdin) = session.stdin.as_mut() else {
        return Ok(());
    };
    stdin.write_all(format!("{command}\n").as_bytes()).await
}

/// Gives control back to herdr before the child is dropped (and killed).
async fn release(mut session: Session) {
    if session.stdin.is_none() {
        return;
    }
    if let Err(err) = write_command(&mut session, &json!({"type": "terminal.release"})).await {
        tracing::debug!(%err, "terminal release not delivered");
        return;
    }
    // Let herdr finish the release; the child is killed on drop either way.
    let drained = async { while let Ok(Some(_)) = session.stdout.next_line().await {} };
    if tokio::time::timeout(RELEASE_GRACE, drained).await.is_err() {
        tracing::debug!("herdr kept the terminal session open after release");
    }
}

fn parse_line(line: &str) -> Result<Event, String> {
    #[derive(Deserialize)]
    #[serde(tag = "type")]
    enum Line {
        #[serde(rename = "terminal.frame")]
        Frame {
            bytes: String,
            #[serde(default)]
            full: bool,
            width: u16,
            height: u16,
        },
        #[serde(rename = "terminal.closed")]
        Closed {},
    }
    match serde_json::from_str::<Line>(line)
        .map_err(|err| format!("unexpected herdr output: {err}"))?
    {
        Line::Frame { bytes, full, width, height } => Ok(Event::Frame {
            bytes: BASE64.decode(bytes).map_err(|err| format!("bad frame bytes: {err}"))?,
            full,
            cols: width,
            rows: height,
        }),
        Line::Closed {} => Ok(Event::Closed),
    }
}

/// Coalesces frames for up to 50ms or 32KiB and emits them in chunks of at most 64KiB.
#[derive(Default)]
struct Coalescer {
    bytes: Vec<u8>,
    full: bool,
    size: (u16, u16),
    /// The size last sent to the client.
    sent_size: Option<(u16, u16)>,
    deadline: Option<Instant>,
}

impl Coalescer {
    /// Adds an event; true when the session closed (pending output already flushed).
    fn push(&mut self, event: Event, emit: &mut impl FnMut(Output)) -> bool {
        match event {
            Event::Frame { bytes, full, cols, rows } => {
                self.bytes.extend_from_slice(&bytes);
                self.full |= full;
                self.size = (cols, rows);
                if self.bytes.len() >= COALESCE_BYTES {
                    self.flush(emit);
                } else if self.deadline.is_none() {
                    self.deadline = Some(Instant::now() + COALESCE_FOR);
                }
                false
            }
            Event::Closed => {
                self.flush(emit);
                true
            }
        }
    }

    /// Emits pending output; a repaint or resize goes out even with no bytes.
    fn flush(&mut self, emit: &mut impl FnMut(Output)) {
        self.deadline = None;
        let (cols, rows) = self.size;
        let full = std::mem::take(&mut self.full);
        let bytes = std::mem::take(&mut self.bytes);
        let resized = self.sent_size != Some(self.size);
        if bytes.is_empty() && !full && !resized {
            return;
        }
        self.sent_size = Some(self.size);
        let chunks: Vec<&[u8]> =
            if bytes.is_empty() { vec![&[]] } else { bytes.chunks(MAX_CHUNK).collect() };
        chunks
            .into_iter()
            .enumerate()
            .map(|(i, chunk)| Output::Frame {
                body: chunk.to_vec(),
                full: full && i == 0,
                cols,
                rows,
            })
            .for_each(&mut *emit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frames_and_close() {
        let line = r#"{"type":"terminal.frame","seq":3,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"aGk="}"#;
        assert_eq!(
            parse_line(line),
            Ok(Event::Frame { bytes: b"hi".to_vec(), full: true, cols: 80, rows: 24 })
        );
        assert_eq!(parse_line(r#"{"type":"terminal.closed","reason":"exit"}"#), Ok(Event::Closed));
        assert!(parse_line(r#"{"type":"terminal.other"}"#).is_err());
        assert!(
            parse_line(r#"{"type":"terminal.frame","width":1,"height":1,"bytes":"!"}"#).is_err()
        );
    }

    #[test]
    fn repaints_and_resizes_are_sent_even_without_bytes() {
        let mut sent = Vec::new();
        let mut emit = |o: Output| {
            if let Output::Frame { body, full, cols, rows } = o {
                sent.push((body.len(), full, cols, rows));
            }
        };
        let frame = |full, cols| Event::Frame { bytes: Vec::new(), full, cols, rows: 24 };
        let mut out = Coalescer::default();
        out.push(frame(false, 80), &mut emit);
        out.flush(&mut emit); // first size
        out.push(frame(false, 80), &mut emit);
        out.flush(&mut emit); // nothing new
        out.push(frame(true, 80), &mut emit);
        out.flush(&mut emit); // repaint
        out.push(frame(false, 100), &mut emit);
        out.flush(&mut emit); // resize
        assert_eq!(sent, [(0, false, 80, 24), (0, true, 80, 24), (0, false, 100, 24)]);
    }

    #[test]
    fn flushes_in_bounded_chunks_marking_only_the_first_full() {
        let mut frames = Vec::new();
        let mut emit = |o: Output| {
            if let Output::Frame { body, full, .. } = o {
                frames.push((body, full));
            }
        };
        let mut out = Coalescer::default();
        let big = vec![7u8; MAX_CHUNK * 2 + 10];
        assert!(
            !out.push(
                Event::Frame { bytes: big.clone(), full: true, cols: 80, rows: 24 },
                &mut emit
            )
        );
        assert!(frames.iter().all(|(body, _)| body.len() <= MAX_CHUNK));
        assert_eq!(frames.iter().map(|(_, full)| *full).collect::<Vec<_>>(), [true, false, false]);
        assert_eq!(frames.iter().flat_map(|(body, _)| body.clone()).collect::<Vec<u8>>(), big);
    }
}
