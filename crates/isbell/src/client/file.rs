//! A machine's files as streams. Reading: chunks arrive, and credit is granted as the caller takes
//! them. Writing: chunks go out as the machine grants credit, paced when they go through the relay.

use std::time::Duration;

use isbell_proto::flow::{Credit, MAX_CHUNK, WINDOW};
use isbell_proto::frame::RpcError;
use serde_json::json;
use tokio::time::{Interval, MissedTickBehavior};

use super::{Session, Stream, StreamEvent};

/// Opening only stats or creates a file.
const OPEN_TIMEOUT: Duration = Duration::from_secs(30);
/// Over the relay a client may send 50 messages a second; one chunk every 25ms stays under that,
/// so an upload is never cut off by the relay's limit.
const CHUNK_EVERY: Duration = Duration::from_millis(25);

/// A file being read from a machine.
pub struct FileRead {
    pub size: u64,
    stream: Stream,
    /// The stream ended, with or without an error; there is nothing more to read.
    done: bool,
}

impl Session {
    /// Opens the file at the absolute `path` on machine `mid`.
    pub async fn read_file(&self, mid: &str, path: &str) -> Result<FileRead, RpcError> {
        let (r, stream) =
            self.open_stream(mid, "isbell.file.read", json!({"path": path}), OPEN_TIMEOUT).await?;
        let size = r["size"]
            .as_u64()
            .ok_or_else(|| RpcError::new("protocol_error", "file.read answered without a size"))?;
        stream.credit(WINDOW);
        Ok(FileRead { size, stream, done: false })
    }
}

impl FileRead {
    /// The next chunk; `None` once the whole file arrived (and after an error). Taking it counts
    /// the previous one as consumed, so the sender never gets ahead of the caller by more than a
    /// window.
    pub async fn next(&mut self) -> Option<Result<Vec<u8>, RpcError>> {
        if self.done {
            return None;
        }
        loop {
            match self.stream.next().await {
                StreamEvent::Chunk(chunk) => return Some(Ok(chunk)),
                StreamEvent::End(end) => {
                    self.done = true;
                    return end.map(Err);
                }
                StreamEvent::Frame { .. } | StreamEvent::Credit(_) => {
                    tracing::debug!("ignoring a frame a file read does not carry")
                }
            }
        }
    }
}

/// A file being written to a machine. Dropping it before [`FileWrite::finish`] abandons the write:
/// the machine keeps the file as it was.
pub struct FileWrite {
    stream: Stream,
    credit: Credit,
    /// Only over the relay; a direct link takes chunks as fast as credit allows.
    pace: Option<Interval>,
}

impl Session {
    /// Starts writing `size` bytes to the absolute `path` on machine `mid`; its directory must exist.
    pub async fn write_file(
        &self,
        mid: &str,
        path: &str,
        size: u64,
    ) -> Result<FileWrite, RpcError> {
        let params = json!({"path": path, "size": size});
        let (_, stream) = self.open_stream(mid, "isbell.file.write", params, OPEN_TIMEOUT).await?;
        let pace = (!stream.is_direct()).then(|| {
            let mut pace = tokio::time::interval(CHUNK_EVERY);
            pace.set_missed_tick_behavior(MissedTickBehavior::Delay);
            pace
        });
        Ok(FileWrite { stream, credit: Credit::default(), pace })
    }
}

impl FileWrite {
    /// Sends one chunk (at most `MAX_CHUNK` bytes) once the machine's credit and the pace allow.
    /// Fails as soon as the machine ended the write (e.g. its disk is full).
    pub async fn send(&mut self, chunk: Vec<u8>) -> Result<(), RpcError> {
        assert!(chunk.len() <= MAX_CHUNK, "chunks are at most MAX_CHUNK bytes");
        let len = chunk.len() as u64;
        loop {
            // Watch the machine while waiting for credit and the pace.
            tokio::select! {
                biased;
                event = self.stream.next() => self.credit = granted(self.credit, event)?,
                _ = paced(&mut self.pace), if self.credit.available() >= len => break,
            }
        }
        self.credit = self.credit.spent(len);
        self.stream.chunk(chunk);
        Ok(())
    }

    /// Tells the machine every byte was sent and waits until it stored the file.
    pub async fn finish(mut self) -> Result<(), RpcError> {
        self.stream.close();
        loop {
            match self.stream.next().await {
                StreamEvent::End(end) => return end.map_or(Ok(()), Err),
                event => self.credit = granted(self.credit, event)?,
            }
        }
    }
}

async fn paced(pace: &mut Option<Interval>) {
    if let Some(pace) = pace {
        pace.tick().await;
    }
}

/// The credit after an event of a file being written; its end before `finish` is an error.
fn granted(credit: Credit, event: StreamEvent) -> Result<Credit, RpcError> {
    match event {
        StreamEvent::Credit(n) => Ok(credit.granted(n)),
        StreamEvent::End(err) => {
            Err(err.unwrap_or_else(|| RpcError::new("incomplete", "the machine ended the write")))
        }
        StreamEvent::Chunk(_) | StreamEvent::Frame { .. } => Ok(credit),
    }
}
