//! Where one caller's frames come from and where replies go. Over the relay many callers share one
//! connection and are told apart by `to`; a direct link will carry one caller and no route. Above
//! this, frames carry no routing fields.

use isbell_proto::frame::{Frame, Route};
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct Link {
    /// Tells callers apart, e.g. for the stream registry: the caller's relay connection id.
    key: String,
    /// Over the relay this is the process-wide outbox, so it outlives relay connections.
    out: mpsc::UnboundedSender<Frame>,
    route: Route,
}

impl Link {
    pub fn relay(conn: String, out: mpsc::UnboundedSender<Frame>) -> Link {
        let route = Route { to: Some(conn.clone()), ..Route::default() };
        Link { key: conn, out, route }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn send(&self, frame: Frame) {
        if self.out.send(frame.rerouted(self.route.clone())).is_err() {
            tracing::debug!(caller = self.key, "gateway stopped before a frame was sent");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::frame::Header;

    #[test]
    fn relay_links_address_the_caller() {
        let (out, mut rx) = mpsc::unbounded_channel();
        Link::relay("c1".into(), out).send(Frame::new(Header::End {
            id: 3,
            e: None,
            mid: None,
            from: None,
            to: None,
        }));
        let sent = rx.try_recv().unwrap();
        assert_eq!(sent.header.route(), Some(Route { to: Some("c1".into()), ..Route::default() }));
        assert_eq!(sent.header.id(), Some(3));
    }
}
