//! What frames from the relay ask of the gateway, and the frames that answer them: the mapping
//! between the wire protocol and calls / stream input.

use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
use serde_json::Value;

use crate::gateway::rpc;
use crate::gateway::terminal::{Input, Output};

/// The methods a gateway serves. A new method gets a variant here and its handler in
/// `Calls::start` (`calls/mod.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Herdr,
    StartAgent,
    Terminal,
}

impl Method {
    const ALL: [Method; 3] = [Method::Herdr, Method::StartAgent, Method::Terminal];

    pub fn name(self) -> &'static str {
        match self {
            Method::Herdr => "herdr",
            Method::StartAgent => "isbell.agent.start",
            Method::Terminal => "isbell.terminal",
        }
    }

    fn parse(m: &str) -> Option<Method> {
        Method::ALL.into_iter().find(|method| method.name() == m)
    }
}

/// Methods advertised in `caps`: the herdr methods passed through, and the gateway's own.
pub fn methods() -> Vec<String> {
    let own = Method::ALL.into_iter().filter(|m| *m != Method::Herdr).map(Method::name);
    rpc::ALLOWED.iter().copied().chain(own).map(str::to_owned).collect()
}

/// A stream by its caller's connection and call id.
pub type StreamKey = (String, u64);

/// What a frame from the relay asks of the gateway.
#[derive(Debug, PartialEq)]
pub enum Inbound {
    /// `method` is the unknown name when the gateway does not serve it.
    Call {
        id: u64,
        to: String,
        method: Result<Method, String>,
        p: Value,
    },
    Input {
        key: StreamKey,
        input: Input,
    },
    Ignore(&'static str),
}

pub fn route(frame: Frame) -> Inbound {
    let input = |from, id, input| Inbound::Input { key: (from, id), input };
    match frame.header {
        Header::Call { id, m, p, from: Some(to), .. } => {
            Inbound::Call { id, to, method: Method::parse(&m).ok_or(m), p }
        }
        Header::Data { id, k, cols, rows, from: Some(from), .. } => match (k, cols, rows) {
            (DataKind::Input, ..) => input(from, id, Input::Bytes(frame.body.unwrap_or_default())),
            (DataKind::Resize, Some(cols @ 1..), Some(rows @ 1..)) => {
                input(from, id, Input::Resize(cols, rows))
            }
            (DataKind::Ping, ..) => input(from, id, Input::Ping),
            (DataKind::Resize | DataKind::Frame, ..) => Inbound::Ignore("invalid stream frame"),
        },
        Header::End { id, from: Some(from), .. } => input(from, id, Input::Close),
        _ => Inbound::Ignore("unexpected frame"),
    }
}

pub fn response_frame(id: u64, to: String, result: Result<Value, RpcError>) -> Frame {
    let (ok, r, e) = match result {
        Ok(r) => (true, Some(r), None),
        Err(e) => (false, None, Some(e)),
    };
    Frame::new(Header::Res { id, ok, r, e, mid: None, to: Some(to) })
}

pub fn output_frame(id: u64, to: &str, output: Output) -> Frame {
    let to = Some(to.to_owned());
    match output {
        Output::Frame { body, full, cols, rows } => {
            let (full, cols, rows) = (Some(full), Some(cols), Some(rows));
            let header = Header::Data {
                id,
                k: DataKind::Frame,
                full,
                cols,
                rows,
                mid: None,
                from: None,
                to,
            };
            Frame { header, body: Some(body) }
        }
        Output::End(e) => Frame::new(Header::End { id, e, mid: None, from: None, to }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(m: &str) -> Frame {
        Frame::new(Header::Call {
            id: 1,
            m: m.into(),
            p: json!({}),
            mid: None,
            from: Some("c".into()),
        })
    }

    fn data(k: DataKind, cols: Option<u16>, rows: Option<u16>, body: Option<&[u8]>) -> Frame {
        let header = Header::Data {
            id: 2,
            k,
            full: None,
            cols,
            rows,
            mid: None,
            from: Some("c".into()),
            to: None,
        };
        Frame { header, body: body.map(<[u8]>::to_vec) }
    }

    fn input(input: Input) -> Inbound {
        Inbound::Input { key: ("c".into(), 2), input }
    }

    #[test]
    fn routes_calls_by_method() {
        let routed = |m| match route(call(m)) {
            Inbound::Call { id: 1, to, method, .. } if to == "c" => method,
            other => panic!("expected a call, got {other:?}"),
        };
        assert_eq!(routed("isbell.terminal"), Ok(Method::Terminal));
        assert_eq!(routed("herdr"), Ok(Method::Herdr));
        assert_eq!(
            routed("agent.list"),
            Err("agent.list".into()),
            "herdr methods go through `herdr`"
        );
    }

    #[test]
    fn routes_client_stream_frames_to_input() {
        assert_eq!(
            route(data(DataKind::Input, None, None, Some(b"ls"))),
            input(Input::Bytes(b"ls".to_vec()))
        );
        assert_eq!(
            route(data(DataKind::Resize, Some(100), Some(30), None)),
            input(Input::Resize(100, 30))
        );
        assert_eq!(route(data(DataKind::Ping, None, None, None)), input(Input::Ping));
        let end = Header::End { id: 2, e: None, mid: None, from: Some("c".into()), to: None };
        assert_eq!(route(Frame::new(end)), input(Input::Close));
        assert!(matches!(
            route(data(DataKind::Resize, Some(0), Some(30), None)),
            Inbound::Ignore(_)
        ));
        assert!(matches!(route(data(DataKind::Frame, None, None, Some(b"x"))), Inbound::Ignore(_)));
    }

    #[test]
    fn addresses_frames_to_the_caller() {
        let res = response_frame(1, "c".into(), Err(RpcError::new("herdr_unavailable", "x")));
        assert!(
            matches!(res.header, Header::Res { id: 1, ok: false, ref to, .. } if to.as_deref() == Some("c"))
        );
        let output = Output::Frame { body: b"hi".to_vec(), full: true, cols: 80, rows: 24 };
        let frame = output_frame(2, "c", output);
        assert!(matches!(
            frame.header,
            Header::Data { id: 2, k: DataKind::Frame, full: Some(true), cols: Some(80), rows: Some(24), ref to, .. }
                if to.as_deref() == Some("c")
        ));
        assert_eq!(frame.body.as_deref(), Some(&b"hi"[..]));
    }

    #[test]
    fn advertises_herdr_methods_and_its_own() {
        let methods = methods();
        assert!(methods.iter().any(|m| m == "agent.list"));
        assert!(methods.iter().any(|m| m == "isbell.terminal"));
        assert!(!methods.iter().any(|m| m == "herdr"));
    }
}
