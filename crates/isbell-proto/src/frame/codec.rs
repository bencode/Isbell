//! Frames on the wire. Changes when the encoding changes.
//!
//! ```text
//! text message   = JSON(header)
//! binary message = u32be(headerLen) ‖ JSON(header) ‖ body
//! ```

use super::{Header, Route};

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("binary frame is truncated")]
    Truncated,
    #[error("frame header is not UTF-8")]
    NotUtf8,
    #[error("invalid frame header: {0}")]
    Header(#[from] serde_json::Error),
}

pub enum Encoded {
    Text(String),
    Binary(Vec<u8>),
}

impl Encoded {
    /// A binary-framed payload as it should go on the wire: text when it has no body.
    pub fn from_binary(payload: Vec<u8>) -> Result<Encoded, FrameError> {
        let (header, body) = split_binary(&payload)?;
        if !body.is_empty() {
            return Ok(Encoded::Binary(payload));
        }
        String::from_utf8(header.to_vec()).map(Encoded::Text).map_err(|_| FrameError::NotUtf8)
    }
}

/// `u32be(headerLen) ‖ header ‖ body` → (header, body).
fn split_binary(msg: &[u8]) -> Result<(&[u8], &[u8]), FrameError> {
    let (len, rest) = msg.split_first_chunk::<4>().ok_or(FrameError::Truncated)?;
    let len = u32::from_be_bytes(*len) as usize;
    (len <= rest.len()).then(|| rest.split_at(len)).ok_or(FrameError::Truncated)
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

    /// The same frame with new routing fields (see [`Header::rerouted`]).
    pub fn rerouted(self, route: Route) -> Frame {
        Frame { header: self.header.rerouted(route), body: self.body }
    }

    pub fn decode(msg: &[u8], binary: bool) -> Result<Frame, FrameError> {
        if !binary {
            return Ok(Frame::new(serde_json::from_slice(msg)?));
        }
        let (header, body) = split_binary(msg)?;
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
        let len = (header.len() as u32).to_be_bytes();
        [&len[..], header.as_bytes(), self.body.as_deref().unwrap_or_default()].concat()
    }

    fn header_json(&self) -> String {
        serde_json::to_string(&self.header).expect("headers always serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{DataKind, RpcError, SnapshotEntry};
    use crate::identity::Role;
    use crate::state::MachineInfo;
    use serde_json::{Value, json};

    fn samples() -> Vec<Frame> {
        let machine = MachineInfo {
            id: "0123456789abcdef".into(),
            name: "macmini".into(),
            hostname: "macmini.local".into(),
            os: "macos".into(),
            version: "0.1.0".into(),
        };
        let headers = vec![
            Header::Challenge { nonce: "n".into(), origin: "wss://isbell.upivot.io".into() },
            Header::Auth {
                role: Role::Gateway,
                pk: "pk".into(),
                sig: "sig".into(),
                machine: Some(machine),
            },
            Header::Auth { role: Role::Client, pk: "pk".into(), sig: "sig".into(), machine: None },
            Header::AuthOk { sid: "s".into(), conn: "s.c".into() },
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
            Header::End { id: 3, e: None, mid: None, from: Some("s.c".into()), to: None },
            Header::State { state: json!({"machine": {"id": "0123456789abcdef"}}) },
            Header::Presence { mid: "m".into(), online: true },
            Header::Snapshot { machines: vec![SnapshotEntry { state: json!({}), online: false }] },
        ];
        let ping = Frame::new(Header::Data {
            id: 5,
            k: DataKind::Ping,
            full: None,
            cols: None,
            rows: None,
            mid: Some("m".into()),
            from: None,
            to: None,
        });
        let with_body = Frame {
            header: Header::Data {
                id: 4,
                k: DataKind::Frame,
                full: Some(true),
                cols: Some(80),
                rows: Some(24),
                mid: None,
                from: None,
                to: Some("s.c".into()),
            },
            body: Some(vec![0, 1, 2, 255]),
        };
        headers.into_iter().map(Frame::new).chain([ping, with_body]).collect()
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
        let Encoded::Text(text) = call.encode() else { panic!("expected text") };
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap(),
            json!({"t": "call", "id": 7, "m": "x", "p": null, "mid": "m"})
        );
    }

    #[test]
    fn rejects_malformed_frames() {
        assert!(matches!(Frame::decode(&[0, 0], true), Err(FrameError::Truncated)));
        assert!(matches!(
            Frame::decode(&[0, 0, 0, 9, b'{', b'}'], true),
            Err(FrameError::Truncated)
        ));
        assert!(matches!(Frame::decode(br#"{"t":"nope"}"#, false), Err(FrameError::Header(_))));
        assert!(matches!(Frame::decode(b"not json", false), Err(FrameError::Header(_))));
    }

    #[test]
    fn binary_payloads_become_text_without_a_body() {
        let text = Frame::new(Header::Presence { mid: "m".into(), online: true });
        assert!(matches!(Encoded::from_binary(text.encode_binary()), Ok(Encoded::Text(_))));
        let with_body = samples().pop().unwrap();
        assert!(matches!(Encoded::from_binary(with_body.encode_binary()), Ok(Encoded::Binary(_))));
        assert!(matches!(Encoded::from_binary(vec![0, 0, 0, 9]), Err(FrameError::Truncated)));
    }
}
