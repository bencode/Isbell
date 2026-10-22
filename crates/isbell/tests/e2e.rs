//! relay + gateway + CLI session, with a fake herdr server on a Unix socket.
//! Needs a real Redis (`docker compose up -d redis`, or REDIS_URL).

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell::cli::{Session, SessionEvent};
use isbell::gateway::{self, GatewayOptions};
use isbell_proto::frame::MachineInfo;
use isbell_proto::identity::Identity;
use isbell_relay::config::{Config, Limits};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

type Calls = Arc<Mutex<Vec<(String, Value)>>>;

/// Answers one request per connection like herdr; subscriptions stay open.
fn fake_herdr(socket: &Path) -> Calls {
    let listener = UnixListener::bind(socket).unwrap();
    let calls: Calls = Arc::default();
    let recorded = Arc::clone(&calls);
    let snapshot: Value = serde_json::from_str(include_str!("fixtures/snapshot.json")).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (calls, snapshot) = (Arc::clone(&recorded), snapshot.clone());
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                let Some(line) = lines.next_line().await.unwrap() else {
                    return;
                };
                let req: Value = serde_json::from_str(&line).unwrap();
                let method = req["method"].as_str().unwrap().to_owned();
                calls
                    .lock()
                    .unwrap()
                    .push((method.clone(), req["params"].clone()));
                let result = match method.as_str() {
                    "session.snapshot" => Some(snapshot),
                    "events.subscribe" => Some(json!({"type": "subscription_started"})),
                    "agent.read" => {
                        Some(json!({"type": "pane_read", "read": {"text": "hello from herdr"}}))
                    }
                    "agent.list" => {
                        Some(json!({"type": "agent_list", "agents": [{"name": "reviewer"}]}))
                    }
                    "workspace.create" => Some(
                        json!({"type": "workspace_created", "root_pane": {"pane_id": "w9:p1"}}),
                    ),
                    "agent.start" => {
                        Some(json!({"type": "agent_started", "agent": {}, "argv": []}))
                    }
                    _ => None,
                };
                let reply = match result {
                    Some(result) => json!({"id": req["id"], "result": result}),
                    None => {
                        json!({"id": req["id"], "error": {"code": "unknown_method", "message": method}})
                    }
                };
                write
                    .write_all(format!("{reply}\n").as_bytes())
                    .await
                    .unwrap();
                if method == "events.subscribe" {
                    // Hold the subscription open until the gateway drops it.
                    while lines.next_line().await.ok().flatten().is_some() {}
                }
            });
        }
    });
    calls
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn next_event(events: &mut tokio::sync::broadcast::Receiver<SessionEvent>) -> SessionEvent {
    tokio::time::timeout(Duration::from_secs(10), events.recv())
        .await
        .expect("event within 10s")
        .unwrap()
}

#[tokio::test]
async fn gateway_serves_cli_through_relay() {
    let port = free_port();
    let relay = isbell_relay::serve(Config {
        bind: ([127, 0, 0, 1], port).into(),
        redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
        public_origin: format!("ws://127.0.0.1:{port}"),
        trust_proxy: false,
        limits: Limits::default(),
    })
    .await
    .expect("relay needs a reachable Redis (docker compose up -d redis)");
    let url = format!("ws://127.0.0.1:{port}/v1/ws");

    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("herdr.sock");
    let calls = fake_herdr(&socket);
    // The only test in this binary, so the process-wide variable cannot race.
    unsafe { std::env::set_var("ISBELL_HERDR_SOCKET", &socket) };

    let id = Identity::generate();
    let mid = format!("{:016x}", rand::random::<u64>());
    let machine = MachineInfo {
        id: mid.clone(),
        name: "fake".into(),
        hostname: "fake.local".into(),
        os: "macos".into(),
        version: "0".into(),
    };
    let session = Session::connect(&url, &id).await.unwrap();
    let mut events = session.events();
    let gateway_task = tokio::spawn(gateway::run(GatewayOptions {
        relay: url.clone(),
        identity: Identity::parse(&id.key_string()).unwrap(),
        machine,
    }));

    // The gateway comes online and reports the fixture's agents.
    loop {
        if let SessionEvent::State(state) = next_event(&mut events).await
            && state.machine.id == mid
        {
            assert_eq!(state.agents.len(), 2);
            break;
        }
    }
    let machines = session.machines();
    assert!(
        machines
            .iter()
            .any(|(s, online)| s.machine.id == mid && *online)
    );

    let read = session
        .call(
            &mid,
            "herdr",
            json!({"method": "agent.read", "params": {"target": "reviewer", "source": "recent"}}),
            None,
        )
        .await
        .unwrap();
    assert_eq!(read["read"]["text"], "hello from herdr");

    let denied = session
        .call(
            &mid,
            "herdr",
            json!({"method": "server.stop", "params": {}}),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(denied.code, "method_not_allowed");

    let cwd = tempfile::tempdir().unwrap();
    let started = session
        .call(
            &mid,
            "isbell.agent.start",
            json!({"cwd": cwd.path(), "kind": "codex"}),
            Some(Duration::from_secs(30)),
        )
        .await
        .unwrap();
    assert_eq!(started["paneId"], "w9:p1");
    assert!(started["name"].as_str().unwrap().starts_with("codex-"));
    let methods: Vec<(String, Value)> = calls.lock().unwrap().clone();
    let create = methods
        .iter()
        .position(|(m, _)| m == "workspace.create")
        .expect("workspace.create sent");
    let start = methods
        .iter()
        .position(|(m, _)| m == "agent.start")
        .expect("agent.start sent");
    assert!(create < start);
    assert_eq!(methods[start].1["args"][0], "--no-daemon");
    assert_eq!(methods[start].1["pane_id"], "w9:p1");

    // Stopping the gateway is seen as the machine going offline.
    gateway_task.abort();
    loop {
        if let SessionEvent::Presence {
            mid: m,
            online: false,
        } = next_event(&mut events).await
            && m == mid
        {
            break;
        }
    }
    relay.shutdown();
}
