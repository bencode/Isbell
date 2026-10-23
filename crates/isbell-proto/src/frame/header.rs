//! Frame headers: what each kind of frame carries. Changes when the protocol's fields change.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::identity::Role;
use crate::state::MachineInfo;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Header {
    Challenge {
        nonce: String,
        origin: String,
    },
    Auth {
        role: Role,
        pk: String,
        sig: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        machine: Option<MachineInfo>,
    },
    AuthOk {
        sid: String,
        conn: String,
    },
    Call {
        id: u64,
        m: String,
        #[serde(default)]
        p: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mid: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
    },
    Res {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        r: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        e: Option<RpcError>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mid: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
    Data {
        id: u64,
        k: DataKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        full: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cols: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mid: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
    End {
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        e: Option<RpcError>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mid: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
    /// The receiver of a stream lets its sender send `n` more bytes (see [`crate::flow`]).
    Credit {
        id: u64,
        n: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mid: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
    State {
        state: Value,
    },
    Presence {
        mid: String,
        online: bool,
    },
    Snapshot {
        machines: Vec<SnapshotEntry>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataKind {
    Frame,
    Input,
    Resize,
    /// Client keepalive for a stream; carries nothing.
    Ping,
    /// A piece of a byte stream (a file), in either direction.
    Chunk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: String,
    pub msg: String,
}

impl RpcError {
    pub fn new(code: &str, msg: impl Into<String>) -> Self {
        Self { code: code.to_owned(), msg: msg.into() }
    }

    /// The call's parameters are not what the method takes.
    pub fn bad_request(msg: impl std::fmt::Display) -> Self {
        Self::new("bad_request", msg.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotEntry {
    pub state: Value,
    pub online: bool,
}

/// A frame's routing fields; which of them a kind of frame has depends on its direction.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Route {
    pub mid: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

impl Header {
    /// The request id of a call, response, data, credit or end frame.
    pub fn id(&self) -> Option<u64> {
        match self {
            Header::Call { id, .. }
            | Header::Res { id, .. }
            | Header::Data { id, .. }
            | Header::Credit { id, .. }
            | Header::End { id, .. } => Some(*id),
            _ => None,
        }
    }

    /// The routing fields of a call, response, data, credit or end frame.
    pub fn route(&self) -> Option<Route> {
        let route = |mid: &Option<String>, from: Option<&String>, to: Option<&String>| Route {
            mid: mid.clone(),
            from: from.cloned(),
            to: to.cloned(),
        };
        match self {
            Header::Call { mid, from, .. } => Some(route(mid, from.as_ref(), None)),
            Header::Res { mid, to, .. } => Some(route(mid, None, to.as_ref())),
            Header::Data { mid, from, to, .. }
            | Header::Credit { mid, from, to, .. }
            | Header::End { mid, from, to, .. } => Some(route(mid, from.as_ref(), to.as_ref())),
            _ => None,
        }
    }

    /// The same header with `route` as its routing fields; fields its kind lacks are ignored.
    pub fn rerouted(self, route: Route) -> Header {
        let Route { mid, from, to } = route;
        match self {
            Header::Call { id, m, p, .. } => Header::Call { id, m, p, mid, from },
            Header::Res { id, ok, r, e, .. } => Header::Res { id, ok, r, e, mid, to },
            Header::Data { id, k, full, cols, rows, .. } => {
                Header::Data { id, k, full, cols, rows, mid, from, to }
            }
            Header::Credit { id, n, .. } => Header::Credit { id, n, mid, from, to },
            Header::End { id, e, .. } => Header::End { id, e, mid, from, to },
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(route: Route) -> Header {
        Header::Data {
            id: 4,
            k: DataKind::Input,
            full: None,
            cols: None,
            rows: None,
            mid: None,
            from: None,
            to: None,
        }
        .rerouted(route)
    }

    #[test]
    fn rerouting_replaces_only_the_routing_fields() {
        let to_client = Route { mid: Some("m".into()), ..Route::default() };
        let header =
            data(Route { from: Some("c".into()), to: Some("x".into()), ..Route::default() })
                .rerouted(to_client.clone());
        assert_eq!(header.route(), Some(to_client));
        assert_eq!(header.id(), Some(4));
        assert!(matches!(header, Header::Data { k: DataKind::Input, .. }));
    }

    #[test]
    fn kinds_without_a_field_ignore_it() {
        let res = Header::Res { id: 1, ok: true, r: None, e: None, mid: None, to: None };
        let rerouted = res.rerouted(Route {
            mid: Some("m".into()),
            from: Some("ignored".into()),
            to: Some("c".into()),
        });
        assert_eq!(
            rerouted.route(),
            Some(Route { mid: Some("m".into()), from: None, to: Some("c".into()) })
        );
        assert_eq!(Header::Presence { mid: "m".into(), online: true }.route(), None);
    }
}
