//! Relay integration tests. They need a real Redis (`docker compose up -d redis`, or REDIS_URL)
//! and fail when it is unreachable.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use isbell_proto::frame::{DataKind, Encoded, Frame, Header, MachineInfo};
use isbell_proto::identity::{Identity, Role};
use isbell_relay::config::{Config, Limits};
use isbell_relay::{
    CLOSE_AUTH_FAILED, CLOSE_AUTH_TIMEOUT, CLOSE_BAD_FRAME, CLOSE_REPLACED, RelayHandle,
};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

const ORIGIN: &str = "ws://relay.test";
const QUIET: Duration = Duration::from_millis(300);

fn redis_url() -> String {
    std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into())
}

async fn start(limits: Limits) -> RelayHandle {
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

fn machine(id: &str) -> MachineInfo {
    MachineInfo {
        id: id.into(),
        name: "test".into(),
        hostname: "test.local".into(),
        os: "macos".into(),
        version: "0.0.0".into(),
    }
}

fn random_mid() -> String {
    format!("{:016x}", rand::random::<u64>())
}

struct Peer {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    conn: String,
}

impl Peer {
    async fn open(relay: &RelayHandle) -> (WebSocketStream<MaybeTlsStream<TcpStream>>, String) {
        let (mut ws, _) = connect_async(format!("ws://{}/v1/ws", relay.addr))
            .await
            .unwrap();
        let Header::Challenge { nonce, origin } = recv_on(&mut ws).await.header else {
            panic!("expected challenge")
        };
        assert_eq!(origin, ORIGIN);
        (ws, nonce)
    }

    async fn connect(relay: &RelayHandle, id: &Identity, machine: Option<MachineInfo>) -> Peer {
        let (mut ws, nonce) = Self::open(relay).await;
        let role = if machine.is_some() {
            Role::Gateway
        } else {
            Role::Client
        };
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

    async fn gateway(relay: &RelayHandle, id: &Identity, mid: &str) -> Peer {
        Self::connect(relay, id, Some(machine(mid))).await
    }

    /// Connects a client and returns it with its initial snapshot.
    async fn client(relay: &RelayHandle, id: &Identity) -> (Peer, Vec<(Value, bool)>) {
        let mut peer = Self::connect(relay, id, None).await;
        let Header::Snapshot { machines } = peer.recv().await.header else {
            panic!("expected snapshot")
        };
        (
            peer,
            machines.into_iter().map(|m| (m.state, m.online)).collect(),
        )
    }

    async fn send(&mut self, frame: Frame) {
        send_on(&mut self.ws, frame).await;
    }

    async fn recv(&mut self) -> Frame {
        recv_on(&mut self.ws).await
    }

    async fn recv_quiet(&mut self) -> Option<Frame> {
        tokio::time::timeout(QUIET, self.recv()).await.ok()
    }

    async fn closed_with(&mut self) -> u16 {
        closed_on(&mut self.ws).await
    }
}

async fn send_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>, frame: Frame) {
    let msg = match frame.encode() {
        Encoded::Text(text) => Message::Text(text.into()),
        Encoded::Binary(bytes) => Message::Binary(bytes.into()),
    };
    ws.send(msg).await.unwrap();
}

async fn recv_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> Frame {
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

async fn closed_on(ws: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> u16 {
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

fn call(id: u64, mid: &str) -> Frame {
    Frame::new(Header::Call {
        id,
        m: "herdr".into(),
        p: json!({"method": "agent.list"}),
        mid: Some(mid.into()),
        from: None,
    })
}

fn error_code(frame: &Frame) -> Option<&str> {
    match &frame.header {
        Header::Res {
            ok: false,
            e: Some(e),
            ..
        }
        | Header::End { e: Some(e), .. } => Some(&e.code),
        _ => None,
    }
}

#[tokio::test]
async fn rejects_bad_signature() {
    let relay = start(Limits::default()).await;
    let (mut ws, nonce) = Peer::open(&relay).await;
    let id = Identity::generate();
    let auth = Header::Auth {
        role: Role::Client,
        pk: id.public_key(),
        sig: id.sign_auth(Role::Client, ORIGIN, &format!("{nonce}x")),
        machine: None,
    };
    send_on(&mut ws, Frame::new(auth)).await;
    assert_eq!(closed_on(&mut ws).await, CLOSE_AUTH_FAILED);
}

#[tokio::test]
async fn closes_unauthenticated_connections() {
    let relay = start(Limits::default()).await;
    let (mut ws, _) = Peer::open(&relay).await;
    assert_eq!(closed_on(&mut ws).await, CLOSE_AUTH_TIMEOUT);
}

#[tokio::test]
async fn call_to_offline_machine_fails() {
    let relay = start(Limits::default()).await;
    let (mut client, _) = Peer::client(&relay, &Identity::generate()).await;
    client.send(call(1, &random_mid())).await;
    assert_eq!(error_code(&client.recv().await), Some("machine_offline"));
}

#[tokio::test]
async fn routes_calls_responses_and_streams() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut client, _) = Peer::client(&relay, &id).await;

    client.send(call(7, &mid)).await;
    let Header::Call {
        id: 7,
        mid: None,
        from: Some(from),
        ..
    } = gateway.recv().await.header
    else {
        panic!("expected routed call")
    };
    assert_eq!(from, client.conn);

    gateway
        .send(Frame::new(Header::Res {
            id: 7,
            ok: true,
            r: Some(json!(["a"])),
            e: None,
            mid: None,
            to: Some(from.clone()),
        }))
        .await;
    let Header::Res {
        id: 7,
        ok: true,
        r,
        mid: Some(m),
        to: None,
        ..
    } = client.recv().await.header
    else {
        panic!("expected res")
    };
    assert_eq!((r, m.as_str()), (Some(json!(["a"])), mid.as_str()));

    let body = vec![0u8, 1, 2, 3, 255];
    let data = Header::Data {
        id: 7,
        k: DataKind::Frame,
        z: None,
        full: Some(true),
        cols: None,
        rows: None,
        mid: None,
        from: None,
        to: Some(from),
    };
    gateway
        .send(Frame {
            header: data,
            body: Some(body.clone()),
        })
        .await;
    let got = client.recv().await;
    assert!(matches!(
        got.header,
        Header::Data {
            id: 7,
            k: DataKind::Frame,
            ..
        }
    ));
    assert_eq!(got.body, Some(body));

    let input = Header::Data {
        id: 7,
        k: DataKind::Input,
        z: None,
        full: None,
        cols: None,
        rows: None,
        mid: Some(mid.clone()),
        from: None,
        to: None,
    };
    client
        .send(Frame {
            header: input,
            body: Some(b"ls\r".to_vec()),
        })
        .await;
    let got = gateway.recv().await;
    assert!(matches!(
        got.header,
        Header::Data {
            k: DataKind::Input,
            ..
        }
    ));
    assert_eq!(got.body.as_deref(), Some(&b"ls\r"[..]));
}

#[tokio::test]
async fn spaces_are_isolated() {
    let relay = start(Limits::default()).await;
    let (a, b) = (Identity::generate(), Identity::generate());
    let mid = random_mid();
    let mut gateway_a = Peer::gateway(&relay, &a, &mid).await;
    let (mut client_b, _) = Peer::client(&relay, &b).await;

    client_b.send(call(1, &mid)).await;
    assert_eq!(error_code(&client_b.recv().await), Some("machine_offline"));
    assert!(gateway_a.recv_quiet().await.is_none());

    let forged = Header::Res {
        id: 1,
        ok: true,
        r: None,
        e: None,
        mid: None,
        to: Some(client_b.conn.clone()),
    };
    gateway_a.send(Frame::new(forged)).await;
    assert!(client_b.recv_quiet().await.is_none());
}

#[tokio::test]
async fn newer_gateway_replaces_older() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut first = Peer::gateway(&relay, &id, &mid).await;
    let mut second = Peer::gateway(&relay, &id, &mid).await;
    assert_eq!(first.closed_with().await, CLOSE_REPLACED);

    let (mut client, _) = Peer::client(&relay, &id).await;
    client.send(call(1, &mid)).await;
    assert!(matches!(
        second.recv().await.header,
        Header::Call { id: 1, .. }
    ));
}

#[tokio::test]
async fn late_clients_get_snapshot_and_presence() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    let (mut early, _) = Peer::client(&relay, &id).await;

    let state = json!({"machine": {"id": mid}, "agents": []});
    gateway
        .send(Frame::new(Header::State {
            state: state.clone(),
        }))
        .await;
    assert_eq!(
        early.recv().await.header,
        Header::State {
            state: state.clone()
        }
    );

    let (mut late, snapshot) = Peer::client(&relay, &id).await;
    assert_eq!(snapshot, vec![(state, true)]);

    drop(gateway);
    assert_eq!(
        late.recv().await.header,
        Header::Presence { mid, online: false }
    );
}

#[tokio::test]
async fn rejects_frames_not_allowed_for_the_role() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let (mut client, _) = Peer::client(&relay, &id).await;
    client
        .send(Frame::new(Header::State { state: json!({}) }))
        .await;
    assert_eq!(client.closed_with().await, CLOSE_BAD_FRAME);

    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;
    gateway
        .send(Frame::new(Header::State {
            state: json!({"machine": {"id": random_mid()}}),
        }))
        .await;
    assert_eq!(gateway.closed_with().await, CLOSE_BAD_FRAME);
}

#[tokio::test]
async fn rate_limits_clients() {
    let relay = start(Limits {
        rate: 0.1,
        burst: 2.0,
        ..Limits::default()
    })
    .await;
    let (mut client, _) = Peer::client(&relay, &Identity::generate()).await;
    let mid = random_mid();
    for id in 1..=3 {
        client.send(call(id, &mid)).await;
    }
    let mut got = Vec::new();
    for _ in 0..3 {
        got.push(error_code(&client.recv().await).map(str::to_owned));
    }
    assert_eq!(
        got,
        ["machine_offline", "machine_offline", "rate_limited"].map(|c| Some(c.to_owned()))
    );
}

#[tokio::test]
async fn gateway_survives_lost_ownership_key() {
    let relay = start(Limits::default()).await;
    let id = Identity::generate();
    let mid = random_mid();
    let mut gateway = Peer::gateway(&relay, &id, &mid).await;

    // Simulates a Redis restart or flush: the ownership key disappears.
    let key = format!("isb:{}:m:{mid}:conn", id.sid());
    let mut redis = redis::Client::open(redis_url())
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: i64 = redis::AsyncCommands::del(&mut redis, &key).await.unwrap();

    // One refresh period later the gateway must still be connected and own the machine.
    let quiet = tokio::time::timeout(Duration::from_secs(11), async {
        loop {
            match gateway.ws.next().await {
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                other => return other,
            }
        }
    })
    .await;
    assert!(
        quiet.is_err(),
        "gateway got {quiet:?} instead of staying connected"
    );
    let owner: Option<String> = redis::AsyncCommands::get(&mut redis, &key).await.unwrap();
    assert_eq!(owner, Some(gateway.conn.clone()));

    let (mut client, _) = Peer::client(&relay, &id).await;
    client.send(call(1, &mid)).await;
    assert!(matches!(
        gateway.recv().await.header,
        Header::Call { id: 1, .. }
    ));
}
