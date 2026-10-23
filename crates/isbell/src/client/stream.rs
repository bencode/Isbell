//! A stream opened with [`Session::open_stream`](super::Session::open_stream): the events it
//! delivers, and the input, resizes and pings a caller sends into it.

use isbell_proto::flow::Grants;
use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
use tokio::sync::mpsc;

use super::inflight::{Inflight, disconnected};
use super::link::Link;

#[derive(Debug)]
pub enum StreamEvent {
    /// A terminal screen update.
    Frame { body: Vec<u8>, full: bool },
    /// A piece of a byte stream (a file being read).
    Chunk(Vec<u8>),
    /// The machine can take `n` more bytes (a file being written).
    Credit(u64),
    /// The stream ended; `Some` when it ended because of an error.
    End(Option<RpcError>),
}

/// Dropping it ends the stream.
pub struct Stream {
    id: u64,
    link: Link,
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    inflight: Inflight,
    /// The machine ended the stream.
    ended: bool,
    /// This side ended it; the machine's end may still follow.
    closed: bool,
    grants: Grants,
    /// Bytes of the frame or chunk handed out last; consumed once the caller asks for more.
    taken: u64,
}

impl Stream {
    pub(super) fn new(
        id: u64,
        link: Link,
        rx: mpsc::UnboundedReceiver<StreamEvent>,
        inflight: Inflight,
    ) -> Stream {
        let (grants, taken) = (Grants::default(), 0);
        Stream { id, link, rx, inflight, ended: false, closed: false, grants, taken }
    }

    /// Whether the stream rides a direct link rather than the relay.
    pub fn is_direct(&self) -> bool {
        self.link.is_direct()
    }

    /// The next event. Asking for it counts the frame or chunk handed out before as consumed, and
    /// grants the machine credit for it, so it never gets more than a window ahead of the caller.
    pub async fn next(&mut self) -> StreamEvent {
        let (grants, grant) = self.grants.consumed(std::mem::take(&mut self.taken));
        self.grants = grants;
        if let Some(n) = grant {
            self.credit(n);
        }
        let event = self.rx.recv().await.unwrap_or_else(|| StreamEvent::End(Some(disconnected())));
        self.taken = match &event {
            StreamEvent::Frame { body, .. } | StreamEvent::Chunk(body) => body.len() as u64,
            StreamEvent::Credit(_) | StreamEvent::End(_) => 0,
        };
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

    /// Sends a piece of a byte stream (a file being written).
    pub fn chunk(&self, bytes: Vec<u8>) {
        self.send(DataKind::Chunk, Some(bytes), None);
    }

    /// Tells the machine this side is done; its own end (and any error) still arrives through
    /// [`Stream::next`].
    pub fn close(&mut self) {
        if !self.closed {
            self.closed = true;
            self.push(Frame::new(Header::End {
                id: self.id,
                e: None,
                mid: None,
                from: None,
                to: None,
            }));
        }
    }

    /// Lets the sender send `n` more bytes (see [`isbell_proto::flow`]).
    pub fn credit(&self, n: u64) {
        self.push(Frame::new(Header::Credit { id: self.id, n, mid: None, from: None, to: None }));
    }

    fn send(&self, k: DataKind, body: Option<Vec<u8>>, size: Option<(u16, u16)>) {
        let (cols, rows) = (size.map(|s| s.0), size.map(|s| s.1));
        let header = Header::Data {
            id: self.id,
            k,
            full: None,
            cols,
            rows,
            mid: None,
            from: None,
            to: None,
        };
        self.push(Frame { header, body });
    }

    fn push(&self, frame: Frame) {
        if self.link.send(frame).is_err() {
            tracing::debug!(id = self.id, "the link to the machine is closed");
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.inflight.forget_stream(self.id);
        if !self.ended {
            self.close();
        }
    }
}
