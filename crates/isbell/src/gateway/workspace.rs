//! Workspaces the gateway creates in herdr for new agents and shells, and the cwd rules they share.

use std::path::{Path, PathBuf};

use isbell_proto::frame::RpcError;
use serde_json::json;

use super::herdr::{Herdr, REQUEST_TIMEOUT};
use crate::env_path;

/// An existing absolute directory, with a leading `~` expanded on this machine.
pub fn resolve_cwd(cwd: &str) -> Result<PathBuf, RpcError> {
    expand_home(cwd).filter(|p| p.is_absolute() && p.is_dir()).ok_or_else(|| {
        RpcError::new("invalid_cwd", format!("{cwd} is not an existing absolute directory"))
    })
}

fn expand_home(path: &str) -> Option<PathBuf> {
    let home = || env_path("HOME");
    match path.strip_prefix('~') {
        Some("") => home(),
        Some(rest) => rest.strip_prefix('/').and_then(|rest| home().map(|h| h.join(rest))),
        None => Some(PathBuf::from(path)),
    }
}

/// The directory's own name, for labels.
pub fn dir_name(cwd: &Path) -> String {
    cwd.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Creates a background workspace in `cwd`; returns its root pane.
pub async fn create(herdr: &Herdr, cwd: &Path, label: &str) -> Result<String, RpcError> {
    let params = json!({"cwd": cwd, "label": label, "focus": false, "env": {}});
    let created = herdr.request("workspace.create", params, Some(REQUEST_TIMEOUT)).await?;
    created["root_pane"]["pane_id"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| RpcError::new("herdr_error", "workspace.create returned no root pane"))
}

/// Closes a pane created for a request that then failed, so it is not left behind.
pub async fn close_pane(herdr: &Herdr, pane: &str, failed: &str) {
    if let Err(err) =
        herdr.request("pane.close", json!({"pane_id": pane}), Some(REQUEST_TIMEOUT)).await
    {
        tracing::warn!(%err, pane, failed, "cannot close the pane created for a failed request");
    }
}
