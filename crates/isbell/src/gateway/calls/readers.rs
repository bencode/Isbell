//! What a shared file's readers reach: files under the share's root, read, and nothing else. To
//! them the root is `/`, so they read as they would on their own machine. Anyone with the link can
//! send frames here, so calls are allowed by name, and which file is read is decided by
//! `file::scoped`, never by the path as asked.

use std::path::PathBuf;

use isbell_proto::frame::{Frame, RpcError};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::ToCalls;
use super::route::{Inbound, Method, response_frame, route};
use super::streams::{Streams, close_caller, feed, register, serve_stream};
use crate::gateway::link::Link;
use crate::gateway::{direct, file};

/// Files read at once, by all the share's readers together.
const MAX_READS: usize = 32;

/// Methods a share's machine advertises.
pub fn methods() -> Vec<String> {
    [Method::FileRead, Method::RtcOffer].map(|m| m.name().to_owned()).to_vec()
}

/// Owns a share's calls: relayed and direct frames both reach it through its inbox.
pub async fn run(mut readers: Readers, mut inbox: mpsc::UnboundedReceiver<ToCalls>) {
    while let Some(message) = inbox.recv().await {
        readers.reap();
        match message {
            ToCalls::Frame(link, frame) => readers.handle(link, *frame),
            ToCalls::Gone(key) => close_caller(&readers.streams, &key),
        }
    }
}

pub struct Readers {
    tasks: JoinSet<()>,
    streams: Streams,
    root: PathBuf,
    /// STUN servers for direct links.
    ice: Vec<String>,
    /// Its own inbox, so that a direct link's frames are held to the same rules.
    inbox: mpsc::UnboundedSender<ToCalls>,
}

impl Readers {
    pub fn new(root: PathBuf, ice: Vec<String>, inbox: mpsc::UnboundedSender<ToCalls>) -> Readers {
        Readers { tasks: JoinSet::new(), streams: Streams::default(), root, ice, inbox }
    }

    fn handle(&mut self, link: Link, frame: Frame) {
        match route(frame) {
            Inbound::Call { id, method: Ok(Method::FileRead), p } => self.read(link, id, p),
            Inbound::Call { id, method: Ok(Method::RtcOffer), p } => {
                let (ice, inbox) = (self.ice.clone(), self.inbox.clone());
                self.tasks.spawn(direct::serve(link, id, p, ice, inbox));
            }
            Inbound::Call { id, .. } => {
                let refused = RpcError::new("method_not_allowed", "a share only reads its files");
                link.send(response_frame(id, Err(refused)));
            }
            Inbound::Input { id, input } => feed(&self.streams, (link.key().to_owned(), id), input),
            Inbound::Ignore(what) => tracing::debug!(what, "ignoring a frame from a reader"),
        }
    }

    fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "share task failed");
            }
        }
    }

    /// Reads the file the caller names under the root, once `file::scoped` allows it.
    fn read(&mut self, link: Link, id: u64, mut p: Value) {
        let slot = match register(&self.streams, (link.key().to_owned(), id), MAX_READS) {
            Ok(slot) => slot,
            Err(err) => return link.send(response_frame(id, Err(err))),
        };
        let root = self.root.clone();
        let open = async move {
            let path = p["path"].as_str().and_then(|path| path.strip_prefix('/'));
            let rel = path.ok_or_else(|| RpcError::bad_request("path must start with /"))?;
            let path = file::scoped(&root, rel)?;
            p["path"] = json!(path.to_string_lossy());
            file::open_read(p).await
        };
        self.tasks.spawn(serve_stream(link, id, slot, open, file::pump_read));
    }
}

#[cfg(test)]
mod tests {
    use isbell_proto::frame::Header;

    use super::*;

    #[tokio::test]
    async fn a_reader_gets_nothing_but_files_and_a_direct_link() {
        let (inbox, _rx) = mpsc::unbounded_channel();
        let mut readers = Readers::new(PathBuf::from("/nonexistent"), Vec::new(), inbox);
        let allowed = [Method::FileRead, Method::RtcOffer];
        for method in Method::ALL.into_iter().filter(|m| !allowed.contains(m)) {
            let (out, mut replies) = mpsc::unbounded_channel();
            let call = Header::Call {
                id: 1,
                m: method.name().into(),
                p: json!({"path": "/etc/passwd", "target": "w1:p1", "mode": "control"}),
                mid: None,
                from: None,
            };
            readers.handle(Link::peer("reader".into(), out), Frame::new(call));
            let reply = replies.try_recv().expect("refused at once");
            assert!(
                matches!(&reply.header, Header::Res { ok: false, e: Some(e), .. } if e.code == "method_not_allowed"),
                "{} must be refused",
                method.name()
            );
        }
        assert!(readers.tasks.is_empty(), "nothing was started for a refused call");
    }
}
