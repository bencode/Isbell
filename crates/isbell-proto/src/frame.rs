//! Frames shared by every transport (relay WebSocket and, later, WebRTC DataChannel).
//!
//! ```text
//! text message   = JSON(header)
//! binary message = u32be(headerLen) ‖ JSON(header) ‖ body
//! ```
//!
//! Routing fields are only present on relay hops:
//! client → relay carries `mid`; relay → gateway carries `from`;
//! gateway → relay carries `to`; relay → client carries `mid`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::identity::Role;

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
        z: Option<u8>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineInfo {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub os: String,
    pub version: String,
}

/// Machine ids are 16 lowercase hex characters.
pub fn is_machine_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

impl MachineInfo {
    pub fn is_valid(&self) -> bool {
        is_machine_id(&self.id)
            && self.name.len() <= 64
            && self.hostname.len() <= 255
            && self.os.len() <= 32
            && self.version.len() <= 32
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: String,
    pub msg: String,
}

impl RpcError {
    pub fn new(code: &str, msg: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            msg: msg.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotEntry {
    pub state: Value,
    pub online: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("binary frame is truncated")]
    Truncated,
    #[error("invalid frame header: {0}")]
    Header(#[from] serde_json::Error),
}

pub enum Encoded {
    Text(String),
    Binary(Vec<u8>),
}

/// A frame; an empty body is normalized to `None`.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub header: Header,
    pub body: Option<Vec<u8>>,
}

impl Frame {
    pub fn new(header: Header) -> Self {
        Self { header, body: None }
    }

    pub fn decode(msg: &[u8], binary: bool) -> Result<Frame, FrameError> {
        if !binary {
            return Ok(Frame::new(serde_json::from_slice(msg)?));
        }
        let (len, rest) = msg.split_first_chunk::<4>().ok_or(FrameError::Truncated)?;
        let len = u32::from_be_bytes(*len) as usize;
        if len > rest.len() {
            return Err(FrameError::Truncated);
        }
        let (header, body) = rest.split_at(len);
        Ok(Frame {
            header: serde_json::from_slice(header)?,
            body: (!body.is_empty()).then(|| body.to_vec()),
        })
    }

    /// Text when there is no body, binary otherwise.
    pub fn encode(&self) -> Encoded {
        match &self.body {
            None => Encoded::Text(self.header_json()),
            Some(_) => Encoded::Binary(self.encode_binary()),
        }
    }

    pub fn encode_binary(&self) -> Vec<u8> {
        let header = self.header_json();
        let body = self.body.as_deref().unwrap_or_default();
        let mut out = Vec::with_capacity(4 + header.len() + body.len());
        out.extend_from_slice(&(header.len() as u32).to_be_bytes());
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(body);
        out
    }

    fn header_json(&self) -> String {
        serde_json::to_string(&self.header).expect("headers always serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn samples() -> Vec<Frame> {
        let machine = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "macmini".into(),
            hostname: "macmini.local".into(),
            os: "macos".into(),
            version: "0.1.0".into(),
        };
        let headers = vec![
            Header::Challenge {
                nonce: "n".into(),
                origin: "wss://isbell.upivot.io".into(),
            },
            Header::Auth {
                role: Role::Gateway,
                pk: "pk".into(),
                sig: "sig".into(),
                machine: Some(machine),
            },
            Header::Auth {
                role: Role::Client,
                pk: "pk".into(),
                sig: "sig".into(),
                machine: None,
            },
            Header::AuthOk {
                sid: "s".into(),
                conn: "s.c".into(),
            },
            Header::Call {
                id: 1,
                m: "herdr".into(),
                p: json!({"method": "agent.list"}),
                mid: Some("m".into()),
                from: None,
            },
            Header::Res {
                id: 1,
                ok: true,
                r: Some(json!([])),
                e: None,
                mid: None,
                to: Some("s.c".into()),
            },
            Header::Res {
                id: 2,
                ok: false,
                r: None,
                e: Some(RpcError::new("machine_offline", "offline")),
                mid: Some("m".into()),
                to: None,
            },
            Header::End {
                id: 3,
                e: None,
                mid: None,
                from: Some("s.c".into()),
                to: None,
            },
            Header::State {
                state: json!({"machine": {"id": "0123456789abcdef"}}),
            },
            Header::Presence {
                mid: "m".into(),
                online: true,
            },
            Header::Snapshot {
                machines: vec![SnapshotEntry {
                    state: json!({}),
                    online: false,
                }],
            },
        ];
        let mut frames: Vec<Frame> = headers.into_iter().map(Frame::new).collect();
        frames.push(Frame {
            header: Header::Data {
                id: 4,
                k: DataKind::Frame,
                z: Some(1),
                full: Some(true),
                cols: Some(80),
                rows: Some(24),
                mid: None,
                from: None,
                to: Some("s.c".into()),
            },
            body: Some(vec![0, 1, 2, 255]),
        });
        frames
    }

    fn decode(encoded: Encoded) -> Frame {
        match encoded {
            Encoded::Text(s) => Frame::decode(s.as_bytes(), false).unwrap(),
            Encoded::Binary(b) => Frame::decode(&b, true).unwrap(),
        }
    }

    #[test]
    fn frames_round_trip() {
        for frame in samples() {
            assert_eq!(decode(frame.encode()), frame);
            assert_eq!(Frame::decode(&frame.encode_binary(), true).unwrap(), frame);
        }
    }

    #[test]
    fn wire_shape_uses_tag_and_omits_absent_fields() {
        let call = Frame::new(Header::Call {
            id: 7,
            m: "x".into(),
            p: Value::Null,
            mid: Some("m".into()),
            from: None,
        });
        let Encoded::Text(text) = call.encode() else {
            panic!("expected text")
        };
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap(),
            json!({"t": "call", "id": 7, "m": "x", "p": null, "mid": "m"})
        );
    }

    #[test]
    fn rejects_malformed_frames() {
        assert!(matches!(
            Frame::decode(&[0, 0], true),
            Err(FrameError::Truncated)
        ));
        assert!(matches!(
            Frame::decode(&[0, 0, 0, 9, b'{', b'}'], true),
            Err(FrameError::Truncated)
        ));
        assert!(matches!(
            Frame::decode(br#"{"t":"nope"}"#, false),
            Err(FrameError::Header(_))
        ));
        assert!(matches!(
            Frame::decode(b"not json", false),
            Err(FrameError::Header(_))
        ));
    }

    #[test]
    fn validates_machine_info() {
        let mut m = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "n".into(),
            hostname: "h".into(),
            os: "o".into(),
            version: "v".into(),
        };
        assert!(m.is_valid());
        m.id = "0123456789ABCDEF".into();
        assert!(!m.is_valid());
    }
}
