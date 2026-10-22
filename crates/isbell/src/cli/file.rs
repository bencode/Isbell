//! `isbell file get | put`: copies a file from or to a machine. Either way the destination appears
//! only once all of it arrived; until then it is a temporary file next to it.

use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::Subcommand;
use isbell_proto::flow::MAX_CHUNK;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use super::Ctx;
use super::output::CliError;
use super::target::{parse_remote_path, resolve_machine};
use crate::client::{FileRead, FileWrite};

/// How long an interrupted upload waits for its end to reach the relay, so the machine drops the
/// partial file at once rather than after its idle timeout.
const ABANDON_GRACE: Duration = Duration::from_millis(300);

#[derive(Subcommand)]
pub enum FileCmd {
    /// Copy a file from a machine. SOURCE is `<machine>:<absolute path>`; DEST defaults to the
    /// file's name in the current directory, `-` writes it to stdout. An existing file is replaced.
    Get { source: String, dest: Option<String> },
    /// Copy a file to a machine. DEST is `<machine>:<absolute path>` in an existing directory. An
    /// existing file is replaced, keeping its permissions.
    Put { source: String, dest: String },
}

pub async fn run(ctx: &Ctx, cmd: FileCmd) -> Result<(), CliError> {
    match cmd {
        FileCmd::Get { source, dest } => get(ctx, source, dest).await,
        FileCmd::Put { source, dest } => put(ctx, source, dest).await,
    }
}

async fn get(ctx: &Ctx, source: String, dest: Option<String>) -> Result<(), CliError> {
    let remote = parse_remote_path(&source)?;
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, remote.machine)?;
    let read = session.read_file(&state.machine.id, remote.path).await?;
    let size = read.size;
    if dest.as_deref() == Some("-") {
        return to_stdout(read).await;
    }
    let local = local_path(remote.path, dest.as_deref());
    let written = tokio::select! {
        written = to_file(read, &local) => written,
        _ = tokio::signal::ctrl_c() => Err(CliError::new("interrupted", "interrupted")),
    };
    if written.is_err() {
        remove_temp(&local).await;
    }
    written?;
    match ctx.out.json {
        true => ctx.out.json(&json!({"path": source, "local": local, "size": size})),
        false => println!("fetched {source} → {} ({size} bytes)", local.display()),
    }
    Ok(())
}

async fn put(ctx: &Ctx, source: String, dest: String) -> Result<(), CliError> {
    let remote = parse_remote_path(&dest)?;
    let local = tokio::fs::File::open(&source).await.map_err(local_error)?;
    let meta = local.metadata().await.map_err(local_error)?;
    if !meta.is_file() {
        let message = format!("{source} is not a regular file");
        return Err(CliError::new("local_io_error", message));
    }
    let size = meta.len();
    let session = ctx.session().await?;
    let machines = session.machines();
    let (state, _) = resolve_machine(&machines, remote.machine)?;
    let write = session.write_file(&state.machine.id, remote.path, size).await?;
    tokio::select! {
        sent = send_all(write, local, size) => sent?,
        _ = tokio::signal::ctrl_c() => {
            // The dropped upload ends its stream; give that end a moment to leave.
            tokio::time::sleep(ABANDON_GRACE).await;
            return Err(CliError::new("interrupted", "interrupted"));
        }
    }
    match ctx.out.json {
        true => ctx.out.json(&json!({"local": source, "path": dest, "size": size})),
        false => println!("sent {source} → {dest} ({size} bytes)"),
    }
    Ok(())
}

/// Sends exactly `size` bytes of `source`, then waits until the machine stored them.
async fn send_all(
    mut write: FileWrite,
    mut source: impl AsyncRead + Unpin,
    size: u64,
) -> Result<(), CliError> {
    let mut sent = 0;
    while sent < size {
        let mut chunk =
            vec![0; usize::try_from(size - sent).map_or(MAX_CHUNK, |n| n.min(MAX_CHUNK))];
        let n = source.read(&mut chunk).await.map_err(local_error)?;
        if n == 0 {
            return Err(CliError::new("local_io_error", "the file got shorter while it was sent"));
        }
        chunk.truncate(n);
        write.send(chunk).await?;
        sent += n as u64;
    }
    Ok(write.finish().await?)
}

/// Where a remote file is copied: `dest`, inside it when it is a directory, else the file's name
/// in the current directory.
fn local_path(remote: &str, dest: Option<&str>) -> PathBuf {
    let name = Path::new(remote).file_name().map(PathBuf::from).unwrap_or_default();
    match dest.map(PathBuf::from) {
        Some(dir) if dir.is_dir() => dir.join(name),
        Some(path) => path,
        None => name,
    }
}

fn temp_path(local: &Path) -> PathBuf {
    let name = local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    local.with_file_name(format!(".{name}.isbell-{}.tmp", std::process::id()))
}

fn local_error(err: std::io::Error) -> CliError {
    CliError::new("local_io_error", err.to_string())
}

async fn to_file(mut read: FileRead, local: &Path) -> Result<(), CliError> {
    let temp = temp_path(local);
    let mut file = tokio::fs::File::create(&temp).await.map_err(local_error)?;
    while let Some(chunk) = read.next().await {
        file.write_all(&chunk?).await.map_err(local_error)?;
    }
    file.flush().await.map_err(local_error)?;
    tokio::fs::rename(&temp, local).await.map_err(local_error)
}

async fn remove_temp(local: &Path) {
    let temp = temp_path(local);
    match tokio::fs::remove_file(&temp).await {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            tracing::warn!(%err, temp = %temp.display(), "cannot remove the partial copy");
        }
        _ => {}
    }
}

async fn to_stdout(mut read: FileRead) -> Result<(), CliError> {
    let mut stdout = tokio::io::stdout();
    while let Some(chunk) = read.next().await {
        stdout.write_all(&chunk?).await.map_err(local_error)?;
    }
    stdout.flush().await.map_err(local_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_next_to_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let dir_arg = dir.path().to_str().unwrap();
        assert_eq!(local_path("/a/b/notes.md", None), PathBuf::from("notes.md"));
        assert_eq!(local_path("/a/b/notes.md", Some(dir_arg)), dir.path().join("notes.md"));
        assert_eq!(local_path("/a/b/notes.md", Some("x/out.md")), PathBuf::from("x/out.md"));
        assert_eq!(temp_path(Path::new("x/out.md")).parent(), Some(Path::new("x")));
    }
}
