//! What a share's viewers reach: the one pane shared, observed, and nothing else. Anyone with the
//! link can send frames here, so calls are allowed by name and what a terminal shows is decided
//! here, never by what the caller asks.

use isbell_proto::frame::{Frame, RpcError};
use serde_json::json;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use super::ToCalls;
use super::route::{Inbound, Method, response_frame, route};
use super::streams::{Emit, Streams, close_caller, feed, register, serve_stream};
use crate::gateway::herdr::HerdrError;
use crate::gateway::link::Link;
use crate::gateway::stream::{Input, Output};
use crate::gateway::terminal::{self, Session};
use crate::gateway::{HerdrSlot, direct};

const MAX_VIEWERS: usize = 5;

/// The pane's size while the share runs; `None` once it has ended.
pub type Screen = Option<(u16, u16)>;

/// Methods a share's machine advertises.
pub fn methods() -> Vec<String> {
    [Method::Terminal, Method::RtcOffer].map(|m| m.name().to_owned()).to_vec()
}

/// Owns a share's calls: relayed and direct frames both reach it through its inbox.
pub async fn run(mut viewers: Viewers, mut inbox: mpsc::UnboundedReceiver<ToCalls>) {
    while let Some(message) = inbox.recv().await {
        viewers.reap();
        match message {
            ToCalls::Frame(link, frame) => viewers.handle(link, *frame),
            ToCalls::Gone(key) => close_caller(&viewers.streams, &key),
        }
    }
}

pub struct Viewers {
    tasks: JoinSet<()>,
    streams: Streams,
    slot: HerdrSlot,
    pane: String,
    screen: watch::Receiver<Screen>,
    /// STUN servers for direct links.
    ice: Vec<String>,
    /// Its own inbox, so that a direct link's frames are held to the same rules.
    inbox: mpsc::UnboundedSender<ToCalls>,
}

impl Viewers {
    pub fn new(
        streams: Streams,
        slot: HerdrSlot,
        pane: String,
        screen: watch::Receiver<Screen>,
        ice: Vec<String>,
        inbox: mpsc::UnboundedSender<ToCalls>,
    ) -> Viewers {
        Viewers { tasks: JoinSet::new(), streams, slot, pane, screen, ice, inbox }
    }

    fn handle(&mut self, link: Link, frame: Frame) {
        match route(frame) {
            Inbound::Call { id, method: Ok(Method::Terminal), .. } => self.open(link, id),
            Inbound::Call { id, method: Ok(Method::RtcOffer), p } => {
                let (ice, inbox) = (self.ice.clone(), self.inbox.clone());
                self.tasks.spawn(direct::serve(link, id, p, ice, inbox));
            }
            Inbound::Call { id, .. } => {
                let refused =
                    RpcError::new("method_not_allowed", "a share only shows its terminal");
                link.send(response_frame(id, Err(refused)));
            }
            Inbound::Input { id, input } => feed(&self.streams, (link.key().to_owned(), id), input),
            Inbound::Ignore(what) => tracing::debug!(what, "ignoring a frame from a viewer"),
        }
    }

    fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "share task failed");
            }
        }
    }

    /// Opens the shared pane for a viewer, whatever it asked for.
    fn open(&mut self, link: Link, id: u64) {
        let mut screen = self.screen.clone();
        let Some((cols, rows)) = *screen.borrow_and_update() else {
            return link.send(response_frame(id, Err(ended("share_ended"))));
        };
        let slot = match register(&self.streams, (link.key().to_owned(), id), MAX_VIEWERS) {
            Ok(slot) => slot,
            Err(err) => return link.send(response_frame(id, Err(err))),
        };
        let herdr = self.slot.read().expect("herdr slot poisoned").clone();
        let params = json!({"target": self.pane, "mode": "observe", "cols": cols, "rows": rows});
        let open = async move {
            let herdr =
                herdr.ok_or_else(|| HerdrError::unavailable("herdr server is not available"));
            terminal::open(&herdr.map_err(RpcError::from)?, params).await
        };
        self.tasks.spawn(serve_stream(link, id, slot, open, move |session, input, emit| {
            pump(session, input, emit, screen)
        }));
    }
}

/// Runs an observed terminal until it ends by itself or the share changes under it: the viewer
/// is told which, to stop or to open it again at the new size.
async fn pump(
    session: Session,
    input: mpsc::Receiver<Input>,
    mut emit: Emit,
    mut screen: watch::Receiver<Screen>,
) {
    let changed = async {
        match screen.changed().await {
            Ok(()) if screen.borrow().is_some() => "resized",
            _ => "share_ended",
        }
    };
    tokio::select! {
        () = terminal::pump(session, input, &mut emit) => {}
        code = changed => emit(Output::End(Some(ended(code)))),
    }
}

fn ended(code: &str) -> RpcError {
    RpcError::new(code, "the shared terminal changed")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use isbell_proto::frame::Header;

    use super::*;

    #[tokio::test]
    async fn a_viewer_gets_nothing_but_the_terminal_and_a_direct_link() {
        let (_screen, seen) = watch::channel(Some((80, 24)));
        let (inbox, _rx) = mpsc::unbounded_channel();
        let mut viewers = Viewers::new(
            Streams::default(),
            Arc::default(),
            "w1:p1".into(),
            seen,
            Vec::new(),
            inbox,
        );
        let allowed = [Method::Terminal, Method::RtcOffer];
        for method in Method::ALL.into_iter().filter(|m| !allowed.contains(m)) {
            let (out, mut replies) = mpsc::unbounded_channel();
            let call = Header::Call {
                id: 1,
                m: method.name().into(),
                p: json!({"target": "w2:p1", "mode": "control"}),
                mid: None,
                from: None,
            };
            viewers.handle(Link::peer("viewer".into(), out), Frame::new(call));
            let reply = replies.try_recv().expect("refused at once");
            assert!(
                matches!(&reply.header, Header::Res { ok: false, e: Some(e), .. } if e.code == "method_not_allowed"),
                "{} must be refused",
                method.name()
            );
        }
        assert!(viewers.tasks.is_empty(), "nothing was started for a refused call");
    }
}
