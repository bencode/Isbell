//! What a client can do with a machine: herdr calls, starting an agent, and terminals.

use std::path::Path;
use std::time::Duration;

use isbell::client::{Session, SessionEvent, Stream, StreamEvent};
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::fake_herdr::Calls;

pub type Events = broadcast::Receiver<SessionEvent>;

/// The gateway comes online and reports the fixture's agents.
pub async fn comes_online(session: &Session, events: &mut Events, mid: &str) {
    loop {
        if let SessionEvent::State(state) = next_event(events).await
            && state.machine.id == mid
        {
            assert_eq!(state.agents.len(), 2);
            break;
        }
    }
    assert!(session.machines().iter().any(|(s, online)| s.machine.id == mid && *online));
}

/// Allowlisted herdr methods pass through; others are refused.
pub async fn herdr_calls(session: &Session, mid: &str) {
    let read =
        json!({"method": "agent.read", "params": {"target": "reviewer", "source": "recent"}});
    let read = session.call(mid, "herdr", read, None).await.unwrap();
    assert_eq!(read["read"]["text"], "hello from herdr");

    let denied = json!({"method": "server.stop", "params": {}});
    let denied = session.call(mid, "herdr", denied, None).await.unwrap_err();
    assert_eq!(denied.code, "method_not_allowed");
}

/// `isbell.agent.start` creates a workspace, then starts the agent in its root pane.
pub async fn agent_start(session: &Session, mid: &str, calls: &Calls) {
    let cwd = tempfile::tempdir().unwrap();
    let start = json!({"cwd": cwd.path(), "kind": "codex"});
    let started = session
        .call(mid, "isbell.agent.start", start, Some(Duration::from_secs(30)))
        .await
        .unwrap();
    assert_eq!(started["paneId"], "w9:p1");
    assert!(started["name"].as_str().unwrap().starts_with("codex-"));
    let methods: Vec<(String, Value)> = calls.lock().unwrap().clone();
    let create =
        methods.iter().position(|(m, _)| m == "workspace.create").expect("workspace.create sent");
    let start = methods.iter().position(|(m, _)| m == "agent.start").expect("agent.start sent");
    assert!(create < start);
    assert_eq!(methods[start].1["args"][0], "--no-daemon");
    assert_eq!(methods[start].1["pane_id"], "w9:p1");
}

const OPEN: Duration = Duration::from_secs(10);

/// control: first frame, input echoed, resize forwarded, release on detach.
pub async fn terminal_control(session: &Session, mid: &str, log: &Path) {
    let control = json!({"target": "w1:p1", "mode": "control", "cols": 80, "rows": 24});
    let (_, mut stream) = session.open_stream(mid, "isbell.terminal", control, OPEN).await.unwrap();
    assert_eq!(next_frame(&mut stream).await, b"hello");
    stream.input(b"ls\r".to_vec());
    assert_eq!(next_frame(&mut stream).await, b"ok");
    logged(log, r#""bytes":"bHMN""#).await;
    stream.resize(100, 30);
    logged(log, r#""cols":100"#).await;
    drop(stream);
    logged(log, "terminal.release").await;
}

/// new: a workspace is created first and its root pane is attached.
pub async fn terminal_new(session: &Session, mid: &str, log: &Path, calls: &Calls) {
    let cwd = tempfile::tempdir().unwrap();
    let new = json!({"new": {"cwd": cwd.path()}, "mode": "control", "cols": 80, "rows": 24});
    let (r, mut stream) = session.open_stream(mid, "isbell.terminal", new, OPEN).await.unwrap();
    assert_eq!(r["paneId"], "w9:p1");
    assert_eq!(next_frame(&mut stream).await, b"hello");
    logged(log, "args terminal session control w9:p1 --cols 80 --rows 24").await;
    let created = calls.lock().unwrap().iter().any(|(m, p)| {
        m == "workspace.create" && p["label"].as_str().is_some_and(|l| l.starts_with("shell-"))
    });
    assert!(created, "workspace.create for the shell");
}

/// observe: input is not forwarded; a request with neither target nor new is refused.
pub async fn terminal_observe(session: &Session, mid: &str, log: &Path) {
    let observe = json!({"target": "w1:p1", "mode": "observe", "cols": 80, "rows": 24});
    let (_, mut stream) = session.open_stream(mid, "isbell.terminal", observe, OPEN).await.unwrap();
    assert_eq!(next_frame(&mut stream).await, b"hello");
    let lines_before = std::fs::read_to_string(log).unwrap().lines().count();
    stream.input(b"x".to_vec());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(std::fs::read_to_string(log).unwrap().lines().count(), lines_before);
    drop(stream);

    let bad = json!({"mode": "control", "cols": 80, "rows": 24});
    let err = session.open_stream(mid, "isbell.terminal", bad, OPEN).await.err().expect("rejected");
    assert_eq!(err.code, "bad_request");
}

pub async fn next_event(events: &mut Events) -> SessionEvent {
    tokio::time::timeout(Duration::from_secs(10), events.recv())
        .await
        .expect("event within 10s")
        .unwrap()
}

async fn next_frame(stream: &mut Stream) -> Vec<u8> {
    let event = tokio::time::timeout(Duration::from_secs(10), stream.next())
        .await
        .expect("frame within 10s");
    match event {
        StreamEvent::Frame { body, .. } => body,
        StreamEvent::Chunk(_) | StreamEvent::Credit(_) => {
            panic!("file traffic on a terminal stream")
        }
        StreamEvent::End(err) => panic!("stream ended: {err:?}"),
    }
}

/// Waits until the fake herdr's log has a line containing `needle`.
async fn logged(log: &Path, needle: &str) {
    let found = async {
        while !std::fs::read_to_string(log).unwrap_or_default().contains(needle) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), found)
        .await
        .unwrap_or_else(|_| panic!("{needle:?} not logged"));
}
