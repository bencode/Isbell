//! Client for the local herdr server's socket API (NDJSON, one request per connection).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use isbell_proto::state::{HerdrState, HerdrStatus};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

pub const PROTOCOL: u32 = 22;
const MAX_RESPONSE: u64 = 4 << 20;
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
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
    fn unavailable(err: impl std::fmt::Display) -> Self {
        Self {
            code: "herdr_unavailable".into(),
            message: err.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct Herdr {
    socket: PathBuf,
    next_id: Arc<AtomicU64>,
}

#[derive(Deserialize)]
struct ServerStatus {
    running: bool,
    /// `null` while the server is not running.
    compatible: Option<bool>,
    protocol: Option<u32>,
    socket: Option<PathBuf>,
    version: Option<String>,
}

/// Finds the local herdr server: `$ISBELL_HERDR_SOCKET`, else `herdr status server --json`.
pub async fn discover() -> Result<(Herdr, HerdrState), HerdrState> {
    let unavailable = |version| HerdrState {
        status: HerdrStatus::Unavailable,
        version,
        protocol: None,
    };
    if let Some(socket) = std::env::var_os("ISBELL_HERDR_SOCKET").filter(|s| !s.is_empty()) {
        let state = HerdrState {
            status: HerdrStatus::Ready,
            version: None,
            protocol: None,
        };
        return Ok((Herdr::new(socket.into()), state));
    }
    let output = tokio::process::Command::new("herdr")
        .args(["status", "server", "--json"])
        .kill_on_drop(true)
        .output();
    let output = match tokio::time::timeout(STATUS_TIMEOUT, output).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            tracing::debug!(%err, "cannot run herdr");
            return Err(unavailable(None));
        }
        Err(_) => {
            tracing::warn!("herdr status timed out");
            return Err(unavailable(None));
        }
    };
    let status: ServerStatus = match serde_json::from_slice(&output.stdout) {
        Ok(status) => status,
        Err(err) => {
            tracing::warn!(%err, "unexpected herdr status output");
            return Err(unavailable(None));
        }
    };
    let state = HerdrState {
        status: HerdrStatus::Ready,
        version: status.version,
        protocol: status.protocol,
    };
    match status.socket {
        _ if !status.running => Err(unavailable(state.version)),
        _ if status.compatible != Some(true) || status.protocol != Some(PROTOCOL) => {
            Err(HerdrState {
                status: HerdrStatus::Incompatible,
                ..state
            })
        }
        Some(socket) => Ok((Herdr::new(socket), state)),
        None => Err(unavailable(state.version)),
    }
}

impl Herdr {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            socket,
            next_id: Arc::default(),
        }
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
                tokio::time::timeout(limit, exchange)
                    .await
                    .map_err(|_| HerdrError {
                        code: "timeout".into(),
                        message: format!(
                            "herdr did not answer {method} within {}s",
                            limit.as_secs()
                        ),
                    })??
            }
            None => exchange.await?,
        };
        match (response.get("result"), response.get("error")) {
            (Some(result), _) => Ok(result.clone()),
            (None, Some(error)) => Err(HerdrError {
                code: error["code"].as_str().unwrap_or("herdr_error").into(),
                message: error["message"].as_str().unwrap_or_default().into(),
            }),
            _ => Err(HerdrError::unavailable("malformed herdr response")),
        }
    }

    async fn exchange(&self, method: &str, params: Value) -> Result<Value, HerdrError> {
        let id = format!("isbell:{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(HerdrError::unavailable)?;
        write_line(
            &mut stream,
            &json!({"id": id, "method": method, "params": params}),
        )
        .await?;
        let mut reader = BufReader::new(stream).take(MAX_RESPONSE);
        let response = read_line(&mut reader)
            .await?
            .ok_or_else(|| HerdrError::unavailable("herdr closed the connection"))?;
        if response["id"] != id.as_str() {
            return Err(HerdrError::unavailable(
                "herdr answered a different request",
            ));
        }
        Ok(response)
    }

    /// Subscribes to pane lifecycle events and to status changes of `panes`, signalling `refresh`
    /// for every event. Returns when the subscription ends (closed, `events_lost`, error).
    pub async fn watch(
        &self,
        panes: &[String],
        refresh: &mpsc::Sender<()>,
    ) -> Result<(), HerdrError> {
        let mut subscriptions: Vec<Value> = LIFECYCLE_EVENTS
            .iter()
            .map(|t| json!({"type": t}))
            .collect();
        subscriptions.extend(
            panes
                .iter()
                .map(|p| json!({"type": "pane.agent_status_changed", "pane_id": p})),
        );
        let request = json!({"id": "isbell:events", "method": "events.subscribe", "params": {"subscriptions": subscriptions}});
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(HerdrError::unavailable)?;
        write_line(&mut stream, &request).await?;
        // herdr treats any further byte on a subscription socket as a disconnect: read only.
        let mut reader = BufReader::new(stream);
        while let Some(line) = read_line(&mut reader).await? {
            if let Some(error) = line.get("error") {
                return Err(HerdrError {
                    code: error["code"].as_str().unwrap_or("herdr_error").into(),
                    message: error["message"].as_str().unwrap_or_default().into(),
                });
            }
            if refresh.try_send(()).is_err() {
                tracing::trace!("refresh already pending");
            }
        }
        Ok(())
    }
}

async fn write_line(stream: &mut UnixStream, value: &Value) -> Result<(), HerdrError> {
    let mut line = value.to_string();
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .await
        .map_err(HerdrError::unavailable)
}

/// Next JSON line; `None` at EOF.
async fn read_line(
    reader: &mut (impl AsyncBufReadExt + Unpin),
) -> Result<Option<Value>, HerdrError> {
    let mut line = String::new();
    let n = reader
        .read_line(&mut line)
        .await
        .map_err(HerdrError::unavailable)?;
    if n == 0 {
        return Ok(None);
    }
    if !line.ends_with('\n') {
        return Err(HerdrError::unavailable(
            "herdr response too large or truncated",
        ));
    }
    serde_json::from_str(&line)
        .map(Some)
        .map_err(HerdrError::unavailable)
}
