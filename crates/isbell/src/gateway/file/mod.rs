//! Files of this machine, at any absolute path or one under `~/`: a directory listed one level at a
//! time, files searched by path, and a file read or written as a stream no faster than the other
//! side grants credit; a file sent for an agent is written where the gateway keeps such files.

mod list;
mod read;
mod search;
mod write;

use std::fs::{DirEntry, Metadata};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use isbell_proto::frame::RpcError;

use super::workspace::expand_home;

pub use self::list::list;
pub use self::read::{open_read, pump_read};
pub use self::search::search;
pub use self::write::{open_upload, open_write, pump_write};

/// A peer that sent nothing for this long, while the other side waits on it, has gone away: over
/// the relay the gateway is not told when a caller disconnects.
const STALLED_FOR: Duration = Duration::from_secs(5 * 60);

/// `path` when it is absolute, a leading `~` read as this machine's home; the methods take no
/// relative paths.
pub(super) fn absolute_path(path: &str) -> Result<PathBuf, RpcError> {
    expand_home(path)
        .filter(|p| p.is_absolute())
        .ok_or_else(|| RpcError::bad_request(format!("{path} is not an absolute path")))
}

fn io_error(err: std::io::Error) -> RpcError {
    let code = match err.kind() {
        ErrorKind::NotFound => "not_found",
        ErrorKind::PermissionDenied => "permission_denied",
        _ => "io_error",
    };
    RpcError::new(code, err.to_string())
}

/// When the file was last modified, in milliseconds since the epoch; `None` where the system does
/// not keep it.
fn mtime_ms(meta: &Metadata) -> Option<u64> {
    let since = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(since.as_millis()).ok()
}

/// Runs blocking filesystem work, many small syscalls, off the async workers.
async fn blocking<T, F>(work: F) -> Result<T, RpcError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, RpcError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| RpcError::new("io_error", err.to_string()))?
}

/// The entries of the directory at `path`, skipping (and logging) one that cannot be read.
fn read_dir(path: &Path) -> Result<impl Iterator<Item = DirEntry> + use<>, RpcError> {
    if !std::fs::metadata(path).map_err(io_error)?.is_dir() {
        let msg = format!("{} is not a directory", path.display());
        return Err(RpcError::new("not_a_directory", msg));
    }
    let entries = std::fs::read_dir(path).map_err(io_error)?;
    Ok(entries.filter_map(|entry| {
        entry.inspect_err(|err| tracing::debug!(%err, "skipping an unreadable entry")).ok()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env_path;

    #[test]
    fn a_path_is_absolute_or_under_the_home() {
        assert_eq!(absolute_path("/tmp/x").unwrap(), Path::new("/tmp/x"));
        if let Some(home) = env_path("HOME") {
            assert_eq!(absolute_path("~/.isbell/x").unwrap(), home.join(".isbell/x"));
        }
        for path in ["relative", "~other/x", ""] {
            assert_eq!(absolute_path(path).unwrap_err().code, "bad_request", "{path}");
        }
    }
}
