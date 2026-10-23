//! Finding the local herdr server: `$ISBELL_HERDR_SOCKET`, else what `herdr status server --json`
//! reports, accepted only when it speaks the protocol this gateway was built for. A server that is
//! not running is started, and found by a later discovery.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use isbell_proto::state::{HerdrState, HerdrStatus};
use serde::Deserialize;

use super::{Herdr, env_path, herdr_bin};

pub const PROTOCOL: u32 = 22;
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
struct ServerStatus {
    running: bool,
    /// `null` while the server is not running.
    compatible: Option<bool>,
    protocol: Option<u32>,
    socket: Option<PathBuf>,
    version: Option<String>,
}

/// The server to use, else the state to report instead.
pub async fn discover() -> Result<(Herdr, HerdrState), HerdrState> {
    if let Some(socket) = env_path("ISBELL_HERDR_SOCKET") {
        let state = HerdrState { status: HerdrStatus::Ready, version: None, protocol: None };
        return Ok((Herdr::new(socket), state));
    }
    let status = server_status().await.ok_or_else(|| unavailable(None))?;
    if !status.running {
        start_server();
    }
    classify(status).map(|(socket, state)| (Herdr::new(socket), state))
}

/// `herdr status server --json`; `None`, with the reason logged, when it cannot be had.
async fn server_status() -> Option<ServerStatus> {
    let output = tokio::process::Command::new(herdr_bin())
        .args(["status", "server", "--json"])
        .kill_on_drop(true)
        .output();
    let output = match tokio::time::timeout(STATUS_TIMEOUT, output).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            tracing::debug!(%err, "cannot run herdr");
            return None;
        }
        Err(_) => {
            tracing::warn!("herdr status timed out");
            return None;
        }
    };
    serde_json::from_slice(&output.stdout)
        .inspect_err(|err| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr = stderr.trim();
            tracing::warn!(%err, status = %output.status, stderr, "unexpected herdr status output");
        })
        .ok()
}

/// Starts `herdr server` in its own process group, so it outlives this gateway; nothing here ever
/// stops it. Dropping the child leaves it running.
fn start_server() {
    let started = tokio::process::Command::new(herdr_bin())
        .arg("server")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
    match started {
        Ok(child) => tracing::info!(pid = child.id(), "started the herdr server"),
        Err(err) => tracing::warn!(%err, "cannot start the herdr server"),
    }
}

/// Where a running, compatible server listens, else the state to report instead.
fn classify(status: ServerStatus) -> Result<(PathBuf, HerdrState), HerdrState> {
    let compatible = status.compatible == Some(true) && status.protocol == Some(PROTOCOL);
    let state = HerdrState {
        status: HerdrStatus::Ready,
        version: status.version,
        protocol: status.protocol,
    };
    match status.socket {
        _ if !status.running => Err(unavailable(state.version)),
        _ if !compatible => Err(HerdrState { status: HerdrStatus::Incompatible, ..state }),
        Some(socket) => Ok((socket, state)),
        None => Err(unavailable(state.version)),
    }
}

fn unavailable(version: Option<String>) -> HerdrState {
    HerdrState { status: HerdrStatus::Unavailable, version, protocol: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn classified(status: Value) -> Result<(PathBuf, HerdrState), HerdrState> {
        classify(serde_json::from_value(status).unwrap())
    }

    #[test]
    fn classifies_server_status() {
        let ok = json!({"running": true, "compatible": true, "protocol": PROTOCOL, "socket": "/s", "version": "1.2"});
        let (socket, state) = classified(ok.clone()).unwrap();
        assert_eq!(
            (socket, state.status, state.version.as_deref()),
            ("/s".into(), HerdrStatus::Ready, Some("1.2"))
        );

        let status_of = |patch: Value| {
            let fields = |v: &Value| v.as_object().unwrap().clone();
            let status = fields(&ok).into_iter().chain(fields(&patch)).collect();
            classified(Value::Object(status)).unwrap_err().status
        };
        assert_eq!(
            status_of(json!({"running": false, "compatible": null})),
            HerdrStatus::Unavailable
        );
        assert_eq!(status_of(json!({"compatible": false})), HerdrStatus::Incompatible);
        assert_eq!(status_of(json!({"protocol": PROTOCOL + 1})), HerdrStatus::Incompatible);
        assert_eq!(status_of(json!({"socket": null})), HerdrStatus::Unavailable);
    }
}
