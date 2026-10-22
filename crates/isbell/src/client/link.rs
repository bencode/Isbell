//! The way frames reach one machine. Over the relay: the shared relay connection, addressed by
//! `mid`; a direct link will reach its machine alone, with no route. Above this, frames carry no
//! routing fields.

use isbell_proto::frame::{Frame, Route, RpcError};
use tokio::sync::mpsc;

use super::inflight::disconnected;

#[derive(Clone)]
pub struct Link {
    out: mpsc::UnboundedSender<Frame>,
    route: Route,
}

impl Link {
    pub fn relay(out: mpsc::UnboundedSender<Frame>, mid: &str) -> Link {
        Link { out, route: Route { mid: Some(mid.to_owned()), ..Route::default() } }
    }

    pub fn send(&self, frame: Frame) -> Result<(), RpcError> {
        self.out.send(frame.rerouted(self.route.clone())).map_err(|_| disconnected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::frame::Header;
    use serde_json::json;

    fn call() -> Frame {
        Frame::new(Header::Call { id: 1, m: "herdr".into(), p: json!({}), mid: None, from: None })
    }

    #[test]
    fn relay_links_address_the_machine() {
        let (out, mut rx) = mpsc::unbounded_channel();
        let link = Link::relay(out, "m1");
        link.send(call()).unwrap();
        let sent = rx.try_recv().unwrap();
        assert_eq!(sent.header.route(), Some(Route { mid: Some("m1".into()), ..Route::default() }));
        drop(rx);
        assert_eq!(link.send(call()).unwrap_err().code, "disconnected");
    }
}
