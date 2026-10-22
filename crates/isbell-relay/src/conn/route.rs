//! Where frames may go. Changes only when the routing rules change; never touches I/O.

use isbell_proto::frame::{Frame, Header, Route};
use isbell_proto::state::is_machine_id;
use serde_json::Value;
use uuid::Uuid;

/// A connection id carries its space, so routing can check it without a lookup.
pub fn conn_id(sid: &str, unique: Uuid) -> String {
    format!("{sid}.{}", unique.simple())
}

pub fn in_space(conn: &str, sid: &str) -> bool {
    conn.strip_prefix(sid).is_some_and(|rest| rest.starts_with('.'))
}

pub enum GatewayRoute {
    /// Cache as the machine's state and broadcast to the space's clients.
    State { json: String, frame: Frame },
    /// Deliver to one client connection; `to` removed, `mid` set to the sender.
    ToClient { conn: String, frame: Frame },
    /// Addressed outside the gateway's space: drop.
    Outside,
    /// Not something a gateway may send.
    Reject,
}

pub fn route_gateway(sid: &str, mid: &str, frame: Frame) -> GatewayRoute {
    if let Header::State { state } = &frame.header {
        let own = state.pointer("/machine/id").and_then(Value::as_str) == Some(mid);
        return match own {
            true => GatewayRoute::State { json: state.to_string(), frame },
            false => GatewayRoute::Reject,
        };
    }
    // Gateways answer clients: a response, or stream data / end, addressed `to` a connection.
    let Some(Route { from: None, to: Some(to), .. }) = frame.header.route() else {
        return GatewayRoute::Reject;
    };
    if matches!(frame.header, Header::Call { .. }) {
        return GatewayRoute::Reject;
    }
    if !in_space(&to, sid) {
        return GatewayRoute::Outside;
    }
    let from_machine = Route { mid: Some(mid.to_owned()), ..Route::default() };
    GatewayRoute::ToClient { conn: to, frame: frame.rerouted(from_machine) }
}

/// A client frame bound for a machine of its space; `mid` removed, `from` set to the client.
pub struct ClientFrame {
    pub id: u64,
    pub mid: String,
    pub is_call: bool,
    pub frame: Frame,
}

/// `None` when a client may not send this frame.
pub fn route_client(conn: &str, frame: Frame) -> Option<ClientFrame> {
    // Clients call machines, or send stream data / credit / end to them, addressed by `mid`.
    let is_call = matches!(frame.header, Header::Call { .. });
    let streamed =
        matches!(frame.header, Header::Data { .. } | Header::Credit { .. } | Header::End { .. });
    if !(is_call || streamed) {
        return None;
    }
    let id = frame.header.id()?;
    let Some(Route { mid: Some(mid), to: None, .. }) = frame.header.route() else {
        return None;
    };
    if !is_machine_id(&mid) {
        return None;
    }
    let from_client = Route { from: Some(conn.to_owned()), ..Route::default() };
    Some(ClientFrame { id, mid, is_call, frame: frame.rerouted(from_client) })
}

#[cfg(test)]
mod tests {
    use isbell_proto::frame::DataKind;
    use serde_json::json;

    use super::*;

    const SID: &str = "space0000000000a";
    const MID: &str = "0123456789abcdef";

    fn data(mid: Option<&str>, from: Option<&str>, to: Option<&str>) -> Frame {
        let header = Header::Data {
            id: 1,
            k: DataKind::Frame,
            full: None,
            cols: None,
            rows: None,
            mid: mid.map(str::to_owned),
            from: from.map(str::to_owned),
            to: to.map(str::to_owned),
        };
        Frame { header, body: Some(vec![1, 2]) }
    }

    #[test]
    fn connection_ids_carry_their_space() {
        let conn = conn_id(SID, Uuid::nil());
        assert!(in_space(&conn, SID));
        assert!(!in_space(&conn, "space0000000000b"));
        assert!(!in_space(&format!("{SID}x.1"), SID), "a longer sid is another space");
    }

    #[test]
    fn gateway_state_must_be_its_own() {
        let own = Frame::new(Header::State { state: json!({"machine": {"id": MID}}) });
        assert!(matches!(route_gateway(SID, MID, own), GatewayRoute::State { .. }));
        let other =
            Frame::new(Header::State { state: json!({"machine": {"id": "ffffffffffffffff"}}) });
        assert!(matches!(route_gateway(SID, MID, other), GatewayRoute::Reject));
    }

    #[test]
    fn gateway_frames_go_to_clients_of_its_space_only() {
        let client = conn_id(SID, Uuid::nil());
        let GatewayRoute::ToClient { conn, frame } =
            route_gateway(SID, MID, data(None, None, Some(&client)))
        else {
            panic!("expected delivery");
        };
        assert_eq!(conn, client);
        assert!(
            matches!(frame.header, Header::Data { mid: Some(ref m), to: None, .. } if m == MID)
        );
        assert_eq!(frame.body, Some(vec![1, 2]));
        let outside = conn_id("space0000000000b", Uuid::nil());
        assert!(matches!(
            route_gateway(SID, MID, data(None, None, Some(&outside))),
            GatewayRoute::Outside
        ));
        assert!(matches!(
            route_gateway(SID, MID, data(None, Some("x"), Some(&client))),
            GatewayRoute::Reject
        ));
    }

    #[test]
    fn client_frames_are_stamped_with_their_connection() {
        let routed = route_client("me", data(Some(MID), Some("forged"), None)).unwrap();
        assert_eq!((routed.id, routed.mid.as_str(), routed.is_call), (1, MID, false));
        assert!(
            matches!(routed.frame.header, Header::Data { mid: None, from: Some(ref f), .. } if f == "me")
        );
        assert!(route_client("me", data(None, None, None)).is_none(), "no target machine");
        assert!(route_client("me", data(Some("not-a-machine"), None, None)).is_none());
        assert!(
            route_client("me", data(Some(MID), None, Some("x"))).is_none(),
            "clients cannot address connections"
        );
        let credit = Header::Credit { id: 2, n: 64, mid: Some(MID.into()), from: None, to: None };
        let routed = route_client("me", Frame::new(credit)).unwrap();
        assert!(
            matches!(routed.frame.header, Header::Credit { n: 64, from: Some(ref f), .. } if f == "me")
        );
    }
}
