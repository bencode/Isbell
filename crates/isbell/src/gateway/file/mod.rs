//! Files of this machine as streams: any absolute path, read or written in chunks no faster than
//! the other side grants credit.

mod read;
mod write;

use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use isbell_proto::frame::RpcError;

pub use self::read::{open_read, pump_read};
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
