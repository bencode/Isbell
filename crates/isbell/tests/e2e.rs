//! relay + gateway + client session, with a fake herdr server on a Unix socket and a TCP
//! forwarder in front of the relay that can cut a connection like a lost network.
//! Needs a real Redis (`docker compose up -d redis`, or REDIS_URL).

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use isbell::client::{Session, SessionEvent};
use isbell::gateway::{self, GatewayOptions};
use isbell::relay::RelayError;
use isbell_proto::frame::{MachineInfo, RpcError};
use isbell_proto::identity::Identity;
use isbell_relay::config::{Config, Limits};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream, UnixListener};
use tokio::sync::{Notify, broadcast};
use tokio::task::JoinHandle;

type Calls = Arc<Mutex<Vec<(String, Value)>>>;

struct FakeHerdr {
    calls: Calls,
    /// Lets one pending `agent.wait` answer.
    release_wait: Arc<Notify>,
}

/// Answers one request per connection like herdr; subscriptions and `agent.wait` stay open.
fn fake_herdr(socket: &Path) -> FakeHerdr {
    let listener = UnixListener::bind(socket).unwrap();
    let herdr = FakeHerdr {
        calls: Arc::default(),
        release_wait: Arc::default(),
    };
    let (calls, release) = (Arc::clone(&herdr.calls), Arc::clone(&herdr.release_wait));
    let snapshot: Value = serde_json::from_str(include_str!("fixtures/snapshot.json")).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (calls, release, snapshot) =
                (Arc::clone(&calls), Arc::clone(&release), snapshot.clone());
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
                    "agent.wait" => {
                        release.notified().await;
                        Some(
                            json!({"type": "agent_info", "agent": {"name": "reviewer", "agent_status": "idle"}}),
                        )
                    }
                    _ => None,
                };
                let reply = match result {
                    Some(result) => json!({"id": req["id"], "result": result}),
                    None => {
                        json!({"id": req["id"], "error": {"code": "unknown_method", "message": method}})
                    }
                };
                // The gateway may already have given up on this request.
                let sent = write
                    .write_all(format!("{reply}\n").as_bytes())
                    .await
                    .is_ok();
                if sent && method == "events.subscribe" {
                    while lines.next_line().await.ok().flatten().is_some() {}
                }
            });
        }
    });
    herdr
}

/// TCP forwarder; `cut(i)` drops the i-th accepted connection on the client side only and keeps
/// the relay side open, as when a gateway loses its network without the relay noticing.
struct Forwarder {
    port: u16,
    links: Arc<Mutex<Vec<Arc<Notify>>>>,
}

impl Forwarder {
    async fn start(upstream_port: u16) -> Forwarder {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let links: Arc<Mutex<Vec<Arc<Notify>>>> = Arc::default();
        let registry = Arc::clone(&links);
        tokio::spawn(async move {
            loop {
                let (down, _) = listener.accept().await.unwrap();
                let up = TcpStream::connect(("127.0.0.1", upstream_port))
                    .await
                    .unwrap();
                let cut = Arc::new(Notify::new());
                registry.lock().unwrap().push(Arc::clone(&cut));
                tokio::spawn(async move {
                    let (mut dr, mut dw) = down.into_split();
                    let (mut ur, mut uw) = up.into_split();
                    let was_cut = tokio::select! {
                        _ = tokio::io::copy(&mut dr, &mut uw) => false,
                        _ = tokio::io::copy(&mut ur, &mut dw) => false,
                        _ = cut.notified() => true,
                    };
                    drop((dr, dw));
                    if was_cut {
                        std::future::pending::<()>().await;
                    }
                    drop((ur, uw));
                });
            }
        });
        Forwarder { port, links }
    }

    fn cut(&self, link: usize) {
        self.links.lock().unwrap()[link].notify_one();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn next_event(events: &mut broadcast::Receiver<SessionEvent>) -> SessionEvent {
    tokio::time::timeout(Duration::from_secs(10), events.recv())
        .await
        .expect("event within 10s")
        .unwrap()
}

async fn wait_for_presence(
    events: &mut broadcast::Receiver<SessionEvent>,
    mid: &str,
    online: bool,
) {
    loop {
        if let SessionEvent::Presence { mid: m, online: o } = next_event(events).await
            && m == mid
        {
            assert_eq!(o, online, "unexpected presence");
            return;
        }
    }
}

/// Waits until herdr has received `n` calls of `method`.
async fn wait_for_calls(calls: &Calls, method: &str, n: usize) {
    while calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(m, _)| m == method)
        .count()
        < n
    {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// An `agent.wait` without a timeout, as `isbell agent wait` sends it.
fn start_wait(session: &Arc<Session>, mid: &str) -> JoinHandle<Result<Value, RpcError>> {
    let (session, mid) = (Arc::clone(session), mid.to_owned());
    tokio::spawn(async move {
        let wait = json!({"method": "agent.wait", "params": {"target": "reviewer"}});
        session.call(&mid, "herdr", wait, None).await
    })
}

async fn finished<T>(task: JoinHandle<T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .expect("finished within 10s")
        .unwrap()
}

fn spawn_gateway(
    url: &str,
    id: &Identity,
    machine: &MachineInfo,
) -> JoinHandle<Result<(), RelayError>> {
    tokio::spawn(gateway::run(GatewayOptions {
        relay: url.to_owned(),
        identity: Identity::parse(&id.key_string()).unwrap(),
        machine: machine.clone(),
    }))
}

#[tokio::test]
async fn gateway_serves_cli_through_relay() {
    // Everyone reaches the relay through the forwarder, so the relay's origin is the forwarder's.
    let relay_port = free_port();
    let forwarder = Forwarder::start(relay_port).await;
    let relay = isbell_relay::serve(Config {
        bind: ([127, 0, 0, 1], relay_port).into(),
        redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
        public_origin: format!("ws://127.0.0.1:{}", forwarder.port),
        trust_proxy: false,
        limits: Limits::default(),
    })
    .await
    .expect("relay needs a reachable Redis (docker compose up -d redis)");
    let url = format!("ws://127.0.0.1:{}/v1/ws", forwarder.port);

    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("herdr.sock");
    let herdr = fake_herdr(&socket);
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
    let session = Arc::new(Session::connect(&url, &id).await.unwrap()); // forwarder link 0
    let mut events = session.events();
    let first_gateway = spawn_gateway(&url, &id, &machine); // link 1

    // The gateway comes online and reports the fixture's agents.
    loop {
        if let SessionEvent::State(state) = next_event(&mut events).await
            && state.machine.id == mid
        {
            assert_eq!(state.agents.len(), 2);
            break;
        }
    }
    assert!(
        session
            .machines()
            .iter()
            .any(|(s, online)| s.machine.id == mid && *online)
    );

    let read =
        json!({"method": "agent.read", "params": {"target": "reviewer", "source": "recent"}});
    let read = session.call(&mid, "herdr", read, None).await.unwrap();
    assert_eq!(read["read"]["text"], "hello from herdr");

    let denied = json!({"method": "server.stop", "params": {}});
    let denied = session.call(&mid, "herdr", denied, None).await.unwrap_err();
    assert_eq!(denied.code, "method_not_allowed");

    let cwd = tempfile::tempdir().unwrap();
    let start = json!({"cwd": cwd.path(), "kind": "codex"});
    let started = session
        .call(
            &mid,
            "isbell.agent.start",
            start,
            Some(Duration::from_secs(30)),
        )
        .await
        .unwrap();
    assert_eq!(started["paneId"], "w9:p1");
    assert!(started["name"].as_str().unwrap().starts_with("codex-"));
    let methods: Vec<(String, Value)> = herdr.calls.lock().unwrap().clone();
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

    // 1. The gateway loses its network and reconnects while the relay still holds the old
    //    connection: the call in flight is answered over the new connection.
    let waiting = start_wait(&session, &mid);
    wait_for_calls(&herdr.calls, "agent.wait", 1).await;
    forwarder.cut(1);
    wait_for_presence(&mut events, &mid, true).await; // reconnected (link 2), never seen offline
    herdr.release_wait.notify_one();
    let answered = finished(waiting)
        .await
        .expect("response delivered after reconnect");
    assert_eq!(answered["type"], "agent_info");

    // 2. A new gateway process takes over the machine: calls sent to the old one fail.
    let waiting = start_wait(&session, &mid);
    wait_for_calls(&herdr.calls, "agent.wait", 2).await;
    tokio::time::sleep(Duration::from_millis(5)).await; // a later boot timestamp
    let second_gateway = spawn_gateway(&url, &id, &machine); // link 3
    let lost = finished(waiting).await.unwrap_err();
    assert_eq!(lost.code, "machine_offline");
    assert!(matches!(
        finished(first_gateway).await,
        Err(RelayError::Replaced)
    ));
    wait_for_presence(&mut events, &mid, true).await; // the takeover is never seen as offline

    // 3. The gateway goes offline: calls in flight fail and clients see the machine offline.
    let waiting = start_wait(&session, &mid);
    wait_for_calls(&herdr.calls, "agent.wait", 3).await;
    second_gateway.abort();
    let lost = finished(waiting).await.unwrap_err();
    assert_eq!(lost.code, "machine_offline");
    wait_for_presence(&mut events, &mid, false).await;
    relay.shutdown();
}
