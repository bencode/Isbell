//! Reading a file: chunks no faster than the reader grants credit.

use isbell_proto::flow::{Credit, MAX_CHUNK};
use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TryRecvError;

use super::{STALLED_FOR, absolute_path, io_error, mtime_ms};
use crate::gateway::stream::{Input, Output};

#[derive(Deserialize)]
struct ReadRequest {
    path: String,
    /// Where to start, in bytes from the start; past the end, at the end.
    offset: Option<u64>,
    /// How many bytes from the end to start, as many as there are at most.
    tail: Option<u64>,
}

/// Opens the regular file at `path` (see `absolute_path`) where it is asked to start; answers with
/// its size, where it starts, and, where known, when it was last modified.
pub async fn open_read(p: Value) -> Result<(File, Value), RpcError> {
    let req: ReadRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    if req.offset.is_some() && req.tail.is_some() {
        return Err(RpcError::new("bad_request", "offset and tail cannot both be given"));
    }
    let path = absolute_path(&req.path)?;
    // Checked before opening, which would wait for a writer on a FIFO.
    let meta = tokio::fs::metadata(&path).await.map_err(io_error)?;
    if !meta.is_file() {
        return Err(RpcError::new("not_a_file", format!("{} is not a regular file", req.path)));
    }
    let size = meta.len();
    let start = match (req.offset, req.tail) {
        (Some(offset), _) => offset.min(size),
        (_, Some(tail)) => size - tail.min(size),
        _ => 0,
    };
    let mut file = File::open(&path).await.map_err(io_error)?;
    if start > 0 {
        file.seek(SeekFrom::Start(start)).await.map_err(io_error)?;
    }
    let mut opened = json!({"size": size, "offset": start});
    if let Some(mtime) = mtime_ms(&meta) {
        opened["mtime"] = json!(mtime);
    }
    Ok((file, opened))
}

/// Sends the file in chunks as credit allows, until all of it is sent, the caller closes the
/// stream, or the caller stops granting credit.
pub async fn pump_read(
    mut file: File,
    mut input: mpsc::Receiver<Input>,
    mut emit: impl FnMut(Output),
) {
    let mut credit = Credit::default();
    loop {
        let next = match credit.available() {
            // Out of credit: wait for the reader, but not forever.
            0 => match tokio::time::timeout(STALLED_FOR, input.recv()).await {
                Ok(received) => with_input(credit, received),
                Err(_) => {
                    let stalled = RpcError::new("idle", "the reader stopped granting credit");
                    return emit(Output::End(Some(stalled)));
                }
            },
            // Credit left: take what already arrived, else send the next chunk.
            _ => match input.try_recv() {
                Ok(received) => with_input(credit, Some(received)),
                Err(TryRecvError::Empty) => send_chunk(&mut file, credit, &mut emit).await,
                Err(TryRecvError::Disconnected) => None,
            },
        };
        let Some(next) = next else { return };
        credit = next;
    }
}

/// The credit after an input from the reader; `None` when the reader closed the stream.
fn with_input(credit: Credit, input: Option<Input>) -> Option<Credit> {
    match input {
        Some(Input::Credit(n)) => Some(credit.granted(n)),
        Some(Input::Close) | None => None,
        Some(_) => Some(credit),
    }
}

/// Sends the next chunk within `credit`; `None` once the stream ended (all sent, or a read failed).
async fn send_chunk(
    file: &mut File,
    credit: Credit,
    emit: &mut impl FnMut(Output),
) -> Option<Credit> {
    let len = usize::try_from(credit.available()).map_or(MAX_CHUNK, |n| n.min(MAX_CHUNK));
    let mut buf = vec![0; len];
    match file.read(&mut buf).await {
        Ok(0) => {
            emit(Output::End(None));
            None
        }
        Ok(n) => {
            buf.truncate(n);
            emit(Output::Chunk(buf));
            Some(credit.spent(n as u64))
        }
        Err(err) => {
            emit(Output::End(Some(io_error(err))));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    async fn opened(content: &[u8]) -> (tempfile::TempDir, File) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.md");
        std::fs::write(&path, content).unwrap();
        let (file, r) = open_read(json!({"path": path})).await.unwrap();
        assert_eq!(r["size"], json!(content.len()));
        assert!(r["mtime"].as_u64().is_some(), "the opened file says when it changed: {r}");
        (dir, file)
    }

    #[tokio::test]
    async fn refuses_what_it_cannot_read_as_a_file() {
        let code = async |p: Value| open_read(p).await.err().unwrap().code;
        assert_eq!(code(json!({"path": "notes.md"})).await, "bad_request");
        assert_eq!(code(json!({})).await, "bad_request");
        assert_eq!(code(json!({"path": "/nonexistent/isbell/f"})).await, "not_found");
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(code(json!({"path": dir.path()})).await, "not_a_file");
        let fifo = dir.path().join("pipe");
        assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
        let refused = tokio::time::timeout(Duration::from_secs(2), code(json!({"path": fifo})));
        assert_eq!(refused.await.expect("refused without waiting for a writer"), "not_a_file");
    }

    #[tokio::test]
    async fn sends_no_more_than_the_credit_granted() {
        let content: Vec<u8> = (0..300_000u32).map(|i| i as u8).collect();
        let (_dir, file) = opened(&content).await;
        let (tx, rx) = mpsc::channel(8);
        let (out_tx, mut out) = mpsc::unbounded_channel();
        let pump = tokio::spawn(pump_read(file, rx, move |o| out_tx.send(o).unwrap()));

        tx.send(Input::Credit(100_000)).await.unwrap();
        let first: Vec<u8> = recv_chunks(&mut out, 100_000).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(out.try_recv().is_err(), "nothing beyond the credit");

        tx.send(Input::Credit(1 << 20)).await.unwrap();
        let rest = recv_chunks(&mut out, content.len() - 100_000).await;
        assert_eq!(out.recv().await, Some(Output::End(None)));
        assert_eq!([first, rest].concat(), content);
        pump.await.unwrap();
    }

    async fn recv_chunks(out: &mut mpsc::UnboundedReceiver<Output>, len: usize) -> Vec<u8> {
        let mut got = Vec::new();
        while got.len() < len {
            match out.recv().await {
                Some(Output::Chunk(chunk)) => {
                    assert!(chunk.len() <= MAX_CHUNK);
                    got.extend(chunk);
                }
                other => panic!("expected a chunk, got {other:?}"),
            }
        }
        assert_eq!(got.len(), len, "chunks stop exactly at the credit");
        got
    }

    async fn read_from(p: Value) -> (Value, Vec<u8>) {
        let (file, r) = open_read(p).await.unwrap();
        let (tx, rx) = mpsc::channel(8);
        tx.send(Input::Credit(1 << 20)).await.unwrap();
        let mut got = Vec::new();
        pump_read(file, rx, |o| {
            if let Output::Chunk(chunk) = o {
                got.extend(chunk);
            }
        })
        .await;
        (r, got)
    }

    #[tokio::test]
    async fn starts_where_it_is_asked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.jsonl");
        std::fs::write(&path, b"0123456789").unwrap();
        let (r, got) = read_from(json!({"path": path, "offset": 4})).await;
        assert_eq!(
            (r["size"].clone(), r["offset"].clone(), got),
            (json!(10), json!(4), b"456789".to_vec())
        );
        let (r, got) = read_from(json!({"path": path, "tail": 3})).await;
        assert_eq!((r["offset"].clone(), got), (json!(7), b"789".to_vec()));
        // Asked for more than there is, it starts at the start, or ends at the end.
        let (r, got) = read_from(json!({"path": path, "tail": 99})).await;
        assert_eq!((r["offset"].clone(), got.len()), (json!(0), 10));
        let (r, got) = read_from(json!({"path": path, "offset": 99})).await;
        assert_eq!((r["offset"].clone(), got), (json!(10), vec![]));
        let both = open_read(json!({"path": path, "offset": 1, "tail": 1})).await;
        assert_eq!(both.err().unwrap().code, "bad_request");
    }

    #[tokio::test]
    async fn closing_the_stream_stops_the_read() {
        let (_dir, file) = opened(b"hello").await;
        let (tx, rx) = mpsc::channel(8);
        tx.send(Input::Close).await.unwrap();
        let mut sent = Vec::new();
        pump_read(file, rx, |o| sent.push(o)).await;
        assert!(sent.is_empty());
    }
}
