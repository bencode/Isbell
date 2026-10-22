//! Reading a machine's files: a stream of chunks, with credit granted as the caller takes them.

use std::time::Duration;

use isbell_proto::flow::{Grants, WINDOW};
use isbell_proto::frame::RpcError;
use serde_json::json;

use super::{Session, Stream, StreamEvent};

/// Opening only stats the file.
const OPEN_TIMEOUT: Duration = Duration::from_secs(30);

/// A file being read from a machine.
pub struct FileRead {
    pub size: u64,
    stream: Stream,
    grants: Grants,
    /// The chunk handed out last; it counts as consumed once the caller asks for the next one.
    last: u64,
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
        Ok(FileRead { size, stream, grants: Grants::default(), last: 0, done: false })
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
        let (grants, grant) = self.grants.consumed(std::mem::take(&mut self.last));
        self.grants = grants;
        if let Some(n) = grant {
            self.stream.credit(n);
        }
        loop {
            match self.stream.next().await {
                StreamEvent::Chunk(chunk) => {
                    self.last = chunk.len() as u64;
                    return Some(Ok(chunk));
                }
                StreamEvent::End(end) => {
                    self.done = true;
                    return end.map(Err);
                }
                StreamEvent::Frame { .. } => tracing::debug!("ignoring a screen frame on a file"),
            }
        }
    }
}
