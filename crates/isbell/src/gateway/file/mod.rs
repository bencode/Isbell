//! Files of this machine, at any absolute path: a directory listed one level at a time, files
//! searched by path, and a file read or written as a stream no faster than the other side grants
//! credit.

mod list;
mod read;
mod search;
mod write;

use std::fs::DirEntry;
use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use isbell_proto::frame::RpcError;

pub use self::list::list;
pub use self::read::{open_read, pump_read};
pub use self::search::search;
pub use self::write::{open_write, pump_write};

/// A peer that sent nothing for this long, while the other side waits on it, has gone away: over
/// the relay the gateway is not told when a caller disconnects.
const STALLED_FOR: Duration = Duration::from_secs(5 * 60);

/// `path` when it is absolute; the methods take no relative paths.
fn absolute_path(path: &str) -> Result<&Path, RpcError> {
    let path = Path::new(path);
    match path.is_absolute() {
        true => Ok(path),
        false => Err(RpcError::bad_request(format!("{} is not an absolute path", path.display()))),
    }
}

fn io_error(err: std::io::Error) -> RpcError {
    let code = match err.kind() {
        ErrorKind::NotFound => "not_found",
        ErrorKind::PermissionDenied => "permission_denied",
        _ => "io_error",
    };
    RpcError::new(code, err.to_string())
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
