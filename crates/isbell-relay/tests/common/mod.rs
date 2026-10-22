//! Shared helpers for the relay integration tests. They need a real Redis
//! (`docker compose up -d redis`, or REDIS_URL) and fail when it is unreachable.
// Each test binary uses its own subset of these helpers.
#![allow(dead_code)]
pub use std::time::Duration;

pub use futures_util::{SinkExt, StreamExt};
use isbell_proto::frame::Encoded;
pub use isbell_proto::frame::{DataKind, Frame, Header};
pub use isbell_proto::identity::{Identity, Role};
pub use isbell_proto::state::MachineInfo;
use isbell_relay::RelayHandle;
use isbell_relay::config::Config;
pub use isbell_relay::config::Limits;
pub use serde_json::{Value, json};
use tokio::net::TcpStream;
pub use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

pub const ORIGIN: &str = "ws://relay.test";
pub const QUIET: Duration = Duration::from_millis(300);

pub fn redis_url() -> String {
    std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into())
}

pub async fn start(limits: Limits) -> RelayHandle {
    let config = Config {
        bind: ([127, 0, 0, 1], 0).into(),
        redis_url: redis_url(),
        public_origin: ORIGIN.into(),
        trust_proxy: false,
        limits,
    };
    isbell_relay::serve(config)
        .await
        .expect("relay needs a reachable Redis (docker compose up -d redis)")
}

pub fn machine(id: &str) -> MachineInfo {
    MachineInfo {
        id: id.into(),
        name: "test".into(),
        hostname: "test.local".into(),
        os: "macos".into(),
        version: "0.0.0".into(),
    }
}

pub fn random_mid() -> String {
    format!("{:016x}", rand::random::<u64>())
}

pub struct Peer {
    pub ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub conn: String,
}

impl Peer {
    pub async fn open(relay: &RelayHandle) -> (WebSocketStream<MaybeTlsStream<TcpStream>>, String) {
        let (mut ws, _) = connect_async(format!("ws://{}/v1/ws", relay.addr)).await.unwrap();
        let Header::Challenge { nonce, origin } = recv_on(&mut ws).await.header else {
            panic!("expected challenge")
        };
        assert_eq!(origin, ORIGIN);
        (ws, nonce)
    }

    pub async fn connect(relay: &RelayHandle, id: &Identity, machine: Option<MachineInfo>) -> Peer {
        let (mut ws, nonce) = Self::open(relay).await;
        let role = if machine.is_some() { Role::Gateway } else { Role::Client };
        let auth = Header::Auth {
            role,
            pk: id.public_key(),
            sig: id.sign_auth(role, ORIGIN, &nonce),
            machine,
        };
        send_on(&mut ws, Frame::new(auth)).await;
        let Header::AuthOk { sid, conn } = recv_on(&mut ws).await.header else {
            panic!("expected auth_ok")
        };
        assert_eq!(sid, id.sid());
        Peer { ws, conn }
    }

    pub async fn gateway(relay: &RelayHandle, id: &Identity, mid: &str) -> Peer {
        Self::connect(relay, id, Some(machine(mid))).await
    }

    /// Connects a client and returns it with its initial snapshot.
    pub async fn client(relay: &RelayHandle, id: &Identity) -> (Peer, Vec<(Value, bool)>) {
        let mut peer = Self::connect(relay, id, None).await;
        let Header::Snapshot { machines } = peer.recv().await.header else {
            panic!("expected snapshot")
        };
        (peer, machines.into_iter().map(|m| (m.state, m.online)).collect())
    }

    pub async fn send(&mut self, frame: Frame) {
        send_on(&mut self.ws, frame).await;
    }

    pub async fn recv(&mut self) -> Frame {
        recv_on(&mut self.ws).await
    }

    pub async fn recv_quiet(&mut self) -> Option<Frame> {
        tokio::time::timeout(QUIET, self.recv()).await.ok()
    }

    pub async fn closed_with(&mut self) -> u16 {
        closed_on(&mut self.ws).await
    }
}

pub async fn send_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>, frame: Frame) {
    let msg = match frame.encode() {
        Encoded::Text(text) => Message::Text(text.into()),
        Encoded::Binary(bytes) => Message::Binary(bytes.into()),
    };
    ws.send(msg).await.unwrap();
}

pub async fn recv_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> Frame {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("frame within 5s")
            .unwrap()
            .unwrap();
        match msg {
            Message::Text(text) => return Frame::decode(text.as_bytes(), false).unwrap(),
            Message::Binary(bytes) => return Frame::decode(&bytes, true).unwrap(),
            Message::Close(frame) => panic!("unexpected close: {frame:?}"),
            _ => {}
        }
    }
}

pub async fn closed_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> u16 {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await
            .expect("close within 15s");
        if let Some(Ok(Message::Close(Some(frame)))) = msg {
            return frame.code.into();
        }
        assert!(msg.is_some(), "connection ended without a close frame");
    }
}

pub fn call(id: u64, mid: &str) -> Frame {
    Frame::new(Header::Call {
        id,
        m: "herdr".into(),
        p: json!({"method": "agent.list"}),
        mid: Some(mid.into()),
        from: None,
    })
}

pub fn error_code(frame: &Frame) -> Option<&str> {
    match &frame.header {
        Header::Res { ok: false, e: Some(e), .. } | Header::End { e: Some(e), .. } => Some(&e.code),
        _ => None,
    }
}

pub fn data(id: u64, k: DataKind, mid: Option<&str>, to: Option<&str>, body: Vec<u8>) -> Frame {
    let header = Header::Data {
        id,
        k,
        full: None,
        cols: None,
        rows: None,
        mid: mid.map(str::to_owned),
        from: None,
        to: to.map(str::to_owned),
    };
    Frame { header, body: Some(body) }
}
