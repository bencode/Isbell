//! A stream opened with [`Session::open_stream`](super::Session::open_stream): the events it
//! delivers, and the input, resizes and pings a caller sends into it.

use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
use tokio::sync::mpsc;

use super::inflight::{Inflight, disconnected};

#[derive(Debug)]
pub enum StreamEvent {
    Frame {
        body: Vec<u8>,
        full: bool,
    },
    /// The stream ended; `Some` when it ended because of an error.
    End(Option<RpcError>),
}

/// Dropping it ends the stream.
pub struct Stream {
    id: u64,
    mid: String,
    out: mpsc::UnboundedSender<Frame>,
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    inflight: Inflight,
    ended: bool,
}

impl Stream {
    pub(super) fn new(
        id: u64,
        mid: String,
        out: mpsc::UnboundedSender<Frame>,
        rx: mpsc::UnboundedReceiver<StreamEvent>,
        inflight: Inflight,
    ) -> Stream {
        Stream { id, mid, out, rx, inflight, ended: false }
    }

    pub async fn next(&mut self) -> StreamEvent {
        let event = self.rx.recv().await.unwrap_or_else(|| StreamEvent::End(Some(disconnected())));
        self.ended |= matches!(event, StreamEvent::End(_));
        event
    }

    pub fn input(&self, bytes: Vec<u8>) {
        self.send(DataKind::Input, Some(bytes), None);
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        self.send(DataKind::Resize, None, Some((cols, rows)));
    }

    pub fn ping(&self) {
        self.send(DataKind::Ping, None, None);
    }

    fn send(&self, k: DataKind, body: Option<Vec<u8>>, size: Option<(u16, u16)>) {
        let (cols, rows) = (size.map(|s| s.0), size.map(|s| s.1));
        let mid = Some(self.mid.clone());
        let header =
            Header::Data { id: self.id, k, full: None, cols, rows, mid, from: None, to: None };
        self.push(Frame { header, body });
    }

    fn push(&self, frame: Frame) {
        if self.out.send(frame).is_err() {
            tracing::debug!(id = self.id, "relay connection closed");
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.inflight.forget_stream(self.id);
        if !self.ended {
            let mid = Some(self.mid.clone());
            self.push(Frame::new(Header::End { id: self.id, e: None, mid, from: None, to: None }));
        }
    }
}
