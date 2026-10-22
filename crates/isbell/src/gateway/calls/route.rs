//! What a caller's frames ask of the gateway, and the frames that answer them: the mapping between
//! the wire protocol and calls / stream input. Frames here carry no routing fields.

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

/// What a frame from a caller asks of the gateway.
#[derive(Debug, PartialEq)]
pub enum Inbound {
    /// `method` is the unknown name when the gateway does not serve it.
    Call {
        id: u64,
        method: Result<Method, String>,
        p: Value,
    },
    Input {
        id: u64,
        input: Input,
    },
    Ignore(&'static str),
}

/// Maps a frame without routing fields (the link has taken them off) to what it asks for.
pub fn route(frame: Frame) -> Inbound {
    let input = |id, input| Inbound::Input { id, input };
    match frame.header {
        Header::Call { id, m, p, .. } => {
            Inbound::Call { id, method: Method::parse(&m).ok_or(m), p }
        }
        Header::Data { id, k, cols, rows, .. } => match (k, cols, rows) {
            (DataKind::Input, ..) => input(id, Input::Bytes(frame.body.unwrap_or_default())),
            (DataKind::Resize, Some(cols @ 1..), Some(rows @ 1..)) => {
                input(id, Input::Resize(cols, rows))
            }
            (DataKind::Ping, ..) => input(id, Input::Ping),
            (DataKind::Resize | DataKind::Frame, ..) => Inbound::Ignore("invalid stream frame"),
        },
        Header::End { id, .. } => input(id, Input::Close),
        _ => Inbound::Ignore("unexpected frame"),
    }
}

pub fn response_frame(id: u64, result: Result<Value, RpcError>) -> Frame {
    let (ok, r, e) = match result {
        Ok(r) => (true, Some(r), None),
        Err(e) => (false, None, Some(e)),
    };
    Frame::new(Header::Res { id, ok, r, e, mid: None, to: None })
}

pub fn output_frame(id: u64, output: Output) -> Frame {
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
                to: None,
            };
            Frame { header, body: Some(body) }
        }
        Output::End(e) => Frame::new(Header::End { id, e, mid: None, from: None, to: None }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use isbell_proto::frame::Route;
    use serde_json::json;

    fn call(m: &str) -> Frame {
        Frame::new(Header::Call { id: 1, m: m.into(), p: json!({}), mid: None, from: None })
    }

    fn data(k: DataKind, cols: Option<u16>, rows: Option<u16>, body: Option<&[u8]>) -> Frame {
        let header =
            Header::Data { id: 2, k, full: None, cols, rows, mid: None, from: None, to: None };
        Frame { header, body: body.map(<[u8]>::to_vec) }
    }

    fn input(input: Input) -> Inbound {
        Inbound::Input { id: 2, input }
    }

    #[test]
    fn routes_calls_by_method() {
        let routed = |m| match route(call(m)) {
            Inbound::Call { id: 1, method, .. } => method,
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
        let end = Header::End { id: 2, e: None, mid: None, from: None, to: None };
        assert_eq!(route(Frame::new(end)), input(Input::Close));
        assert!(matches!(
            route(data(DataKind::Resize, Some(0), Some(30), None)),
            Inbound::Ignore(_)
        ));
        assert!(matches!(route(data(DataKind::Frame, None, None, Some(b"x"))), Inbound::Ignore(_)));
    }

    #[test]
    fn answers_carry_no_route() {
        let res = response_frame(1, Err(RpcError::new("herdr_unavailable", "x")));
        assert!(matches!(res.header, Header::Res { id: 1, ok: false, .. }));
        assert_eq!(res.header.route(), Some(Route::default()));
        let output = Output::Frame { body: b"hi".to_vec(), full: true, cols: 80, rows: 24 };
        let frame = output_frame(2, output);
        assert!(matches!(
            frame.header,
            Header::Data {
                id: 2,
                k: DataKind::Frame,
                full: Some(true),
                cols: Some(80),
                rows: Some(24),
                ..
            }
        ));
        assert_eq!(frame.header.route(), Some(Route::default()));
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
