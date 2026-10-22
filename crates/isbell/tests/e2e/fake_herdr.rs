//! A fake herdr server on a Unix socket: one request per connection, answered from a fixed table;
//! subscriptions and `agent.wait` stay open.

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Notify;

/// Every request the fake herdr received: (method, params).
pub type Calls = Arc<Mutex<Vec<(String, Value)>>>;

pub struct FakeHerdr {
    pub calls: Calls,
    /// Lets one pending `agent.wait` answer.
    pub release_wait: Arc<Notify>,
}

/// The fake's answer to `method`; `None` for methods it does not know.
fn answer(method: &str, snapshot: &Value) -> Option<Value> {
    match method {
        "session.snapshot" => Some(snapshot.clone()),
        "events.subscribe" => Some(json!({"type": "subscription_started"})),
        "agent.read" => Some(json!({"type": "pane_read", "read": {"text": "hello from herdr"}})),
        "agent.list" => Some(json!({"type": "agent_list", "agents": [{"name": "reviewer"}]})),
        "workspace.create" => {
            Some(json!({"type": "workspace_created", "root_pane": {"pane_id": "w9:p1"}}))
        }
        "agent.start" => Some(json!({"type": "agent_started", "agent": {}, "argv": []})),
        "agent.wait" => Some(
            json!({"type": "agent_info", "agent": {"name": "reviewer", "agent_status": "idle"}}),
        ),
        _ => None,
    }
}

/// Starts serving on `socket`.
pub fn fake_herdr(socket: &Path) -> FakeHerdr {
    let listener = UnixListener::bind(socket).unwrap();
    let herdr = FakeHerdr { calls: Arc::default(), release_wait: Arc::default() };
    let (calls, release) = (Arc::clone(&herdr.calls), Arc::clone(&herdr.release_wait));
    let snapshot: Value = serde_json::from_str(include_str!("../fixtures/snapshot.json")).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(serve_one(
                stream,
                Arc::clone(&calls),
                Arc::clone(&release),
                snapshot.clone(),
            ));
        }
    });
    herdr
}

async fn serve_one(stream: UnixStream, calls: Calls, release: Arc<Notify>, snapshot: Value) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let Some(line) = lines.next_line().await.unwrap() else {
        return;
    };
    let req: Value = serde_json::from_str(&line).unwrap();
    let method = req["method"].as_str().unwrap().to_owned();
    calls.lock().unwrap().push((method.clone(), req["params"].clone()));
    if method == "agent.wait" {
        release.notified().await;
    }
    let reply = match answer(&method, &snapshot) {
        Some(result) => json!({"id": req["id"], "result": result}),
        None => json!({"id": req["id"], "error": {"code": "unknown_method", "message": method}}),
    };
    // The gateway may already have given up on this request.
    let sent = write.write_all(format!("{reply}\n").as_bytes()).await.is_ok();
    if sent && method == "events.subscribe" {
        while lines.next_line().await.ok().flatten().is_some() {}
    }
}
