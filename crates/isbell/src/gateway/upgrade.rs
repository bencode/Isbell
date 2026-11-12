//! `isbell.upgrade`: installs the latest release as `isbell upgrade` does, for a client to upgrade
//! this machine from afar. The install script restarts the gateway service, which ends this process
//! before the call is answered: an answer means the service was not restarted.

use std::fs::File;
use std::process::Stdio;

use isbell_proto::frame::RpcError;
use serde_json::{Value, json};

use crate::cli::upgrade::install_command;
use crate::env_path;

const TAIL_LINES: usize = 6;
const TAIL_BYTES: usize = 800;

pub async fn upgrade() -> Result<Value, RpcError> {
    let failed =
        |what: &str, err: std::io::Error| RpcError::new("upgrade_failed", format!("{what}: {err}"));
    let home =
        env_path("HOME").ok_or_else(|| RpcError::new("upgrade_failed", "HOME is not set"))?;
    let dir = home.join("Library/Logs/isbell");
    std::fs::create_dir_all(&dir).map_err(|err| failed("cannot create the log directory", err))?;
    let path = dir.join("upgrade.log");
    let log = File::create(&path).map_err(|err| failed("cannot write upgrade.log", err))?;
    let err_log = log.try_clone().map_err(|err| failed("cannot write upgrade.log", err))?;
    let mut command = tokio::process::Command::from(install_command());
    // Its own process group, so that the restart it ends with does not take it along.
    command.stdin(Stdio::null()).stdout(log).stderr(err_log).process_group(0);
    tracing::info!(log = %path.display(), "upgrading isbell");
    let status = command.status().await.map_err(|err| failed("cannot run sh", err))?;
    let said = match std::fs::read_to_string(&path) {
        Ok(log) => tail(&log),
        Err(err) => {
            tracing::warn!(%err, log = %path.display(), "cannot read upgrade.log");
            String::new()
        }
    };
    if status.success() {
        tracing::warn!(%said, "installed, but the gateway service was not restarted");
        Ok(json!({"restarted": false, "log": said}))
    } else {
        tracing::warn!(%status, %said, "the upgrade failed");
        Err(RpcError::new("upgrade_failed", said))
    }
}

/// The end of what the script said: its last lines, cut to a size a page shows.
fn tail(log: &str) -> String {
    let lines: Vec<&str> = log.trim_end().lines().collect();
    let last = lines[lines.len().saturating_sub(TAIL_LINES)..].join("\n");
    match last.len() > TAIL_BYTES {
        true => {
            let cut = (last.len() - TAIL_BYTES..last.len())
                .find(|&i| last.is_char_boundary(i))
                .unwrap_or(0);
            last[cut..].to_owned()
        }
        false => last,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_the_last_lines_within_a_size() {
        assert_eq!(tail(""), "");
        assert_eq!(tail("a\nb\n"), "a\nb");
        let many = (1..=10).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(tail(&many), "5\n6\n7\n8\n9\n10");
        let long = "é".repeat(TAIL_BYTES);
        let cut = tail(&long);
        assert!(cut.len() <= TAIL_BYTES && cut.chars().all(|c| c == 'é'));
    }
}
