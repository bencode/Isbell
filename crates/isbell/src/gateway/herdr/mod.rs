//! Client for the local herdr server: its socket API (NDJSON, one request per connection) and the
//! CLI commands only the executable offers.

mod discover;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

pub use self::discover::discover;

/// How long a herdr request may take unless the caller says otherwise.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE: u64 = 4 << 20;
const LIFECYCLE_EVENTS: &[&str] = &[
    "pane.created",
    "pane.closed",
    "pane.updated",
    "pane.moved",
    "pane.exited",
    "pane.agent_detected",
];

/// A herdr error, with herdr's own code preserved (e.g. `agent_blocked`).
#[derive(Debug, Clone, thiserror::Error)]
#[error("{code}: {message}")]
pub struct HerdrError {
    pub code: String,
    pub message: String,
}

impl HerdrError {
    pub fn unavailable(err: impl std::fmt::Display) -> Self {
        Self { code: "herdr_unavailable".into(), message: err.to_string() }
    }

    /// herdr answered with something the gateway does not understand.
    pub fn protocol(err: impl std::fmt::Display) -> Self {
        Self { code: "herdr_error".into(), message: err.to_string() }
    }

    /// herdr's `{"code", "message"}` error object.
    fn from_error(error: &Value) -> Self {
        Self {
            code: error["code"].as_str().unwrap_or("herdr_error").into(),
            message: error["message"].as_str().unwrap_or_default().into(),
        }
    }
}

impl From<HerdrError> for RpcError {
    fn from(err: HerdrError) -> Self {
        RpcError { code: err.code, msg: err.message }
    }
}

#[derive(Clone)]
pub struct Herdr {
    socket: PathBuf,
    /// The herdr executable, for commands only its CLI offers (status, terminal sessions).
    bin: PathBuf,
    next_id: Arc<AtomicU64>,
}

/// `$ISBELL_HERDR_BIN`, else `herdr` from PATH.
fn herdr_bin() -> PathBuf {
    crate::env_path("ISBELL_HERDR_BIN").unwrap_or_else(|| PathBuf::from("herdr"))
}

/// The `events.subscribe` list: pane lifecycle events, and status changes of `panes`.
fn subscriptions(panes: &[String]) -> Value {
    let lifecycle = LIFECYCLE_EVENTS.iter().map(|t| json!({"type": t}));
    let statuses = panes.iter().map(|p| json!({"type": "pane.agent_status_changed", "pane_id": p}));
    Value::Array(lifecycle.chain(statuses).collect())
}

impl Herdr {
    pub fn new(socket: PathBuf) -> Self {
        Self { socket, bin: herdr_bin(), next_id: Arc::default() }
    }

    /// A herdr CLI command (e.g. `terminal session …`).
    pub fn command(&self) -> tokio::process::Command {
        tokio::process::Command::new(&self.bin)
    }

    /// One request on a fresh connection; `None` timeout waits as long as herdr does.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, HerdrError> {
        let exchange = self.exchange(method, params);
        let response = match timeout {
            Some(limit) => {
                tokio::time::timeout(limit, exchange).await.map_err(|_| HerdrError {
                    code: "timeout".into(),
                    message: format!("herdr did not answer {method} within {}s", limit.as_secs()),
                })??
            }
            None => exchange.await?,
        };
        match (response.get("result"), response.get("error")) {
            (Some(result), _) => Ok(result.clone()),
            (None, Some(error)) => Err(HerdrError::from_error(error)),
            _ => Err(HerdrError::protocol("malformed herdr response")),
        }
    }

    async fn exchange(&self, method: &str, params: Value) -> Result<Value, HerdrError> {
        let id = format!("isbell:{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut stream =
            UnixStream::connect(&self.socket).await.map_err(HerdrError::unavailable)?;
        write_line(&mut stream, &json!({"id": id, "method": method, "params": params})).await?;
        let mut reader = BufReader::new(stream).take(MAX_RESPONSE);
        let response = read_line(&mut reader)
            .await?
            .ok_or_else(|| HerdrError::unavailable("herdr closed the connection"))?;
        if response["id"] != id.as_str() {
            return Err(HerdrError::protocol("herdr answered a different request"));
        }
        Ok(response)
    }

    /// Subscribes to pane lifecycle events and to status changes of `panes`.
    pub async fn subscribe(&self, panes: &[String]) -> Result<Events, HerdrError> {
        let params = json!({"subscriptions": subscriptions(panes)});
        let request =
            json!({"id": "isbell:events", "method": "events.subscribe", "params": params});
        let mut stream =
            UnixStream::connect(&self.socket).await.map_err(HerdrError::unavailable)?;
        write_line(&mut stream, &request).await?;
        Ok(Events(BufReader::new(stream)))
    }
}

/// A live subscription. herdr treats any further byte on its socket as a disconnect: read only.
pub struct Events(BufReader<UnixStream>);

impl Events {
    /// The next event; `None` once herdr ends the subscription (closed, `events_lost`).
    pub async fn next(&mut self) -> Result<Option<Value>, HerdrError> {
        match read_line(&mut self.0).await? {
            Some(line) if line.get("error").is_some() => {
                Err(HerdrError::from_error(&line["error"]))
            }
            line => Ok(line),
        }
    }
}

async fn write_line(stream: &mut UnixStream, value: &Value) -> Result<(), HerdrError> {
    stream.write_all(format!("{value}\n").as_bytes()).await.map_err(HerdrError::unavailable)
}

/// Next JSON line; `None` at EOF.
async fn read_line(
    reader: &mut (impl AsyncBufReadExt + Unpin),
) -> Result<Option<Value>, HerdrError> {
    let mut line = String::new();
    let n = reader.read_line(&mut line).await.map_err(HerdrError::unavailable)?;
    if n == 0 {
        return Ok(None);
    }
    if !line.ends_with('\n') {
        return Err(HerdrError::protocol("herdr response too large or truncated"));
    }
    serde_json::from_str(&line).map(Some).map_err(HerdrError::protocol)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscribes_to_lifecycle_and_each_pane() {
        let subs = subscriptions(&["p1".into(), "p2".into()]);
        let subs = subs.as_array().unwrap();
        assert_eq!(subs.len(), LIFECYCLE_EVENTS.len() + 2);
        assert!(subs.contains(&json!({"type": "pane.created"})));
        assert!(subs.contains(&json!({"type": "pane.agent_status_changed", "pane_id": "p2"})));
    }

    /// An answer it cannot make sense of is herdr's fault, not herdr being away.
    #[tokio::test]
    async fn an_answer_to_another_request_is_a_herdr_error() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("herdr.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut line = String::new();
            BufReader::new(&mut stream).read_line(&mut line).await.unwrap();
            stream.write_all(b"{\"id\":\"another\",\"result\":{}}\n").await.unwrap();
        });
        let err = Herdr::new(socket).request("agent.list", json!({}), None).await.unwrap_err();
        assert_eq!(err.code, "herdr_error");
    }
}
