//! `isbell file get`: copies a file from a machine. A local file appears only once all of it
//! arrived; until then it is written to a temporary file next to it.

use std::path::{Path, PathBuf};

use clap::Subcommand;
use serde_json::json;
use tokio::io::AsyncWriteExt;

use super::Ctx;
use super::output::CliError;
use super::target::{parse_remote_path, resolve_machine};
use crate::client::FileRead;

#[derive(Subcommand)]
pub enum FileCmd {
    /// Copy a file from a machine. SOURCE is `<machine>:<absolute path>`; DEST defaults to the
    /// file's name in the current directory, `-` writes it to stdout. An existing file is replaced.
    Get { source: String, dest: Option<String> },
}

pub async fn run(ctx: &Ctx, cmd: FileCmd) -> Result<(), CliError> {
    let FileCmd::Get { source, dest } = cmd;
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
