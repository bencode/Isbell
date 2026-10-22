//! Reading a file: chunks no faster than the reader grants credit.

use isbell_proto::flow::{Credit, MAX_CHUNK};
use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TryRecvError;

use super::{STALLED_FOR, absolute_path, bad_request, io_error};
use crate::gateway::stream::{Input, Output};

#[derive(Deserialize)]
struct ReadRequest {
    path: String,
}

/// Opens the regular file at the absolute `path`; answers with its size.
pub async fn open_read(p: Value) -> Result<(File, Value), RpcError> {
    let req: ReadRequest = serde_json::from_value(p).map_err(|err| bad_request(err.to_string()))?;
    let file = File::open(absolute_path(&req.path)?).await.map_err(io_error)?;
    let meta = file.metadata().await.map_err(io_error)?;
    if !meta.is_file() {
        return Err(RpcError::new("not_a_file", format!("{} is not a regular file", req.path)));
    }
    Ok((file, json!({"size": meta.len()})))
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
        assert_eq!(r, json!({"size": content.len()}));
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
