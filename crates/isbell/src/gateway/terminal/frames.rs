//! herdr's terminal session protocol (NDJSON on the child's stdio) and how its frames are coalesced
//! into stream output.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::time::Instant;

/// Largest data body, so frames also fit a WebRTC DataChannel message.
const MAX_CHUNK: usize = 64 * 1024;
const COALESCE_FOR: Duration = Duration::from_millis(50);
const COALESCE_BYTES: usize = 32 * 1024;

/// What a client sends into a stream.
#[derive(Debug, PartialEq)]
pub enum Input {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Ping,
    Close,
}

/// What a stream sends to its client.
#[derive(Debug, PartialEq)]
pub enum Output {
    Frame { body: Vec<u8>, full: bool, cols: u16, rows: u16 },
    End(Option<RpcError>),
}

/// What herdr reports on the session's stdout.
#[derive(Debug, PartialEq)]
pub enum Event {
    Frame { bytes: Vec<u8>, full: bool, cols: u16, rows: u16 },
    Closed,
}

/// What a client's input asks of the session.
#[derive(Debug, PartialEq)]
pub enum Command {
    /// One NDJSON line for the session's stdin (observe sessions have none and ignore it).
    Write(Value),
    /// Give control back to herdr and end the session.
    Release,
    Nothing,
}

pub fn command(input: Input) -> Command {
    match input {
        Input::Bytes(bytes) => {
            Command::Write(json!({"type": "terminal.input", "bytes": BASE64.encode(bytes)}))
        }
        Input::Resize(cols, rows) => {
            Command::Write(json!({"type": "terminal.resize", "cols": cols, "rows": rows}))
        }
        Input::Ping => Command::Nothing,
        Input::Close => Command::Release,
    }
}

pub fn release_command() -> Value {
    json!({"type": "terminal.release"})
}

/// One read from the session's stdout: a line, or end of output (the session closed).
pub fn read_event(line: std::io::Result<Option<String>>) -> Result<Event, String> {
    match line {
        Ok(Some(line)) => parse_line(&line),
        Ok(None) => Ok(Event::Closed),
        Err(err) => Err(err.to_string()),
    }
}

pub fn parse_line(line: &str) -> Result<Event, String> {
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

/// Coalesces frames for up to 50ms or 32KiB and outputs them in chunks of at most 64KiB.
#[derive(Default)]
pub struct Coalescer {
    bytes: Vec<u8>,
    full: bool,
    size: (u16, u16),
    /// The size last sent to the client.
    sent_size: Option<(u16, u16)>,
    deadline: Option<Instant>,
}

impl Coalescer {
    /// Adds an event seen at `now`: the output due at once, and whether the session closed.
    pub fn push(self, event: Event, now: Instant) -> (Self, Vec<Output>, bool) {
        match event {
            Event::Frame { bytes, full, cols, rows } => {
                let mut pending = self.bytes;
                pending.extend(bytes);
                let next = Coalescer {
                    bytes: pending,
                    full: self.full || full,
                    size: (cols, rows),
                    deadline: self.deadline.or(Some(now + COALESCE_FOR)),
                    ..self
                };
                if next.bytes.len() < COALESCE_BYTES {
                    return (next, Vec::new(), false);
                }
                let (next, output) = next.flush();
                (next, output, false)
            }
            Event::Closed => {
                let (next, output) = self.flush();
                (next, output, true)
            }
        }
    }

    /// Pending output; a repaint or resize goes out even with no bytes.
    pub fn flush(self) -> (Self, Vec<Output>) {
        let (cols, rows) = self.size;
        let changed = !self.bytes.is_empty() || self.full || self.sent_size != Some(self.size);
        let chunks: Vec<&[u8]> = match (changed, self.bytes.is_empty()) {
            (false, _) => Vec::new(),
            (true, true) => vec![&[]],
            (true, false) => self.bytes.chunks(MAX_CHUNK).collect(),
        };
        let output = chunks
            .into_iter()
            .enumerate()
            .map(|(i, chunk)| Output::Frame {
                body: chunk.to_vec(),
                full: self.full && i == 0,
                cols,
                rows,
            })
            .collect();
        (Coalescer { size: self.size, sent_size: Some(self.size), ..Coalescer::default() }, output)
    }

    /// When pending output is due.
    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(bytes: Vec<u8>, full: bool, cols: u16) -> Event {
        Event::Frame { bytes, full, cols, rows: 24 }
    }

    /// (body length, full, cols) of each output frame.
    fn shapes(output: &[Output]) -> Vec<(usize, bool, u16)> {
        output
            .iter()
            .filter_map(|o| match o {
                Output::Frame { body, full, cols, .. } => Some((body.len(), *full, *cols)),
                Output::End(_) => None,
            })
            .collect()
    }

    #[test]
    fn parses_frames_and_close() {
        let line = r#"{"type":"terminal.frame","seq":3,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"aGk="}"#;
        assert_eq!(parse_line(line), Ok(frame(b"hi".to_vec(), true, 80)));
        assert_eq!(parse_line(r#"{"type":"terminal.closed","reason":"exit"}"#), Ok(Event::Closed));
        assert_eq!(read_event(Ok(None)), Ok(Event::Closed));
        assert!(parse_line(r#"{"type":"terminal.other"}"#).is_err());
        assert!(
            parse_line(r#"{"type":"terminal.frame","width":1,"height":1,"bytes":"!"}"#).is_err()
        );
    }

    #[test]
    fn small_frames_wait_for_the_deadline() {
        let now = Instant::now();
        let (out, output, closed) = Coalescer::default().push(frame(vec![1; 10], false, 80), now);
        assert!(output.is_empty() && !closed);
        assert_eq!(out.deadline(), Some(now + COALESCE_FOR));
        let (out, output, _) = out.push(frame(vec![2; 10], false, 80), now + COALESCE_FOR / 2);
        assert!(output.is_empty());
        assert_eq!(out.deadline(), Some(now + COALESCE_FOR), "the first frame sets the deadline");
        let (out, output) = out.flush();
        assert_eq!(shapes(&output), [(20, false, 80)]);
        assert_eq!(out.deadline(), None);
    }

    #[test]
    fn repaints_and_resizes_are_sent_even_without_bytes() {
        let now = Instant::now();
        let step = |out: Coalescer, full, cols| {
            let (pushed, _, _) = out.push(frame(Vec::new(), full, cols), now);
            pushed.flush()
        };
        let (out, first_size) = step(Coalescer::default(), false, 80);
        let (out, nothing_new) = step(out, false, 80);
        let (out, repaint) = step(out, true, 80);
        let (_, resize) = step(out, false, 100);
        assert_eq!(shapes(&first_size), [(0, false, 80)]);
        assert!(nothing_new.is_empty());
        assert_eq!(shapes(&repaint), [(0, true, 80)]);
        assert_eq!(shapes(&resize), [(0, false, 100)]);
    }

    #[test]
    fn large_output_goes_out_at_once_in_bounded_chunks() {
        let big = vec![7u8; MAX_CHUNK * 2 + 10];
        let (out, output, closed) =
            Coalescer::default().push(frame(big.clone(), true, 80), Instant::now());
        assert!(!closed && out.deadline().is_none());
        assert_eq!(
            shapes(&output).iter().map(|(len, full, _)| (*len, *full)).collect::<Vec<_>>(),
            [(MAX_CHUNK, true), (MAX_CHUNK, false), (10, false)]
        );
        let bodies = output.into_iter().flat_map(|o| match o {
            Output::Frame { body, .. } => body,
            Output::End(_) => Vec::new(),
        });
        assert!(bodies.eq(big));
    }

    #[test]
    fn close_flushes_pending_output() {
        let now = Instant::now();
        let (out, _, _) = Coalescer::default().push(frame(vec![1; 5], false, 80), now);
        let (_, output, closed) = out.push(Event::Closed, now);
        assert!(closed);
        assert_eq!(shapes(&output), [(5, false, 80)]);
    }

    #[test]
    fn maps_client_input_to_session_commands() {
        assert_eq!(
            command(Input::Bytes(b"hi".to_vec())),
            Command::Write(json!({"type": "terminal.input", "bytes": "aGk="}))
        );
        assert_eq!(
            command(Input::Resize(100, 30)),
            Command::Write(json!({"type": "terminal.resize", "cols": 100, "rows": 30}))
        );
        assert_eq!(command(Input::Ping), Command::Nothing);
        assert_eq!(command(Input::Close), Command::Release);
    }
}
