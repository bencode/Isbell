//! Writing a file: chunks arrive no faster than the gateway grants credit, go to a temporary file
//! next to the target, and replace the target only once all of them arrived. The target is never
//! left half written.

use std::io::ErrorKind;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};

use isbell_proto::flow::{Grants, WINDOW};
use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use super::{STALLED_FOR, absolute_path, blocking, io_error};
use crate::gateway::stream::{Input, Output};

#[derive(Deserialize)]
struct WriteRequest {
    path: String,
    size: u64,
}

#[derive(Deserialize)]
struct UploadRequest {
    name: String,
    size: u64,
}

/// A file being written: where it goes, its temporary copy, and how much of it arrived.
pub struct Target {
    path: PathBuf,
    temp: PathBuf,
    file: File,
    received: Received,
    /// An upload's own directory, removed with the temporary file when the write fails.
    own: Option<PathBuf>,
}

/// How much of the announced size arrived.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Received {
    bytes: u64,
    size: u64,
    grants: Grants,
}

impl Received {
    /// After a chunk: the credit to grant back once it is written, or `size_mismatch` when the
    /// chunk goes past the announced size.
    fn chunk(self, len: u64) -> Result<(Received, Option<u64>), RpcError> {
        let bytes = self.bytes + len;
        if bytes > self.size {
            let message = format!("more than the {} bytes announced", self.size);
            return Err(RpcError::new("size_mismatch", message));
        }
        let (grants, grant) = self.grants.consumed(len);
        Ok((Received { bytes, grants, ..self }, grant))
    }

    /// Whether the writer's end completes the file.
    fn complete(self) -> Result<(), RpcError> {
        match self.bytes == self.size {
            true => Ok(()),
            false => {
                let message = format!("{} of {} bytes arrived", self.bytes, self.size);
                Err(RpcError::new("incomplete", message))
            }
        }
    }
}

/// Validates the absolute `path` (not a directory) and creates the temporary file next to it;
/// its directory must exist.
pub async fn open_write(p: Value) -> Result<(Target, Value), RpcError> {
    let req: WriteRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let path = real_path(absolute_path(&req.path)?).await?;
    if tokio::fs::metadata(&path).await.is_ok_and(|meta| meta.is_dir()) {
        return Err(RpcError::new("not_a_file", format!("{} is a directory", path.display())));
    }
    Ok((open_at(path, req.size).await?, json!({})))
}

/// A file sent to this machine for an agent: put under `dir` in a directory of its own, both
/// readable by this user alone, by the last part of its name. Answers with its absolute path.
pub async fn open_upload(p: Value, dir: PathBuf) -> Result<(Target, Value), RpcError> {
    let req: UploadRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let own = blocking(move || own_dir(&dir).map_err(io_error)).await?;
    let path = own.join(upload_name(&req.name));
    match open_at(path.clone(), req.size).await {
        Ok(target) => Ok((Target { own: Some(own), ..target }, json!({"path": path}))),
        Err(err) => {
            remove_dir(&own).await;
            Err(err)
        }
    }
}

/// The last part of `name` without control characters; `file` when nothing of it is left.
fn upload_name(name: &str) -> String {
    let last = Path::new(name).file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    let clean: String = last.chars().filter(|c| !c.is_control()).collect();
    match clean.as_str() {
        "" | "." | ".." => "file".into(),
        _ => clean,
    }
}

/// A new directory under `dir`, which is made when missing.
fn own_dir(dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let own = dir.join(format!("{:08x}", rand::random::<u32>()));
    std::fs::DirBuilder::new().mode(0o700).create(&own)?;
    Ok(own)
}

/// Creates the temporary file next to `path` that `size` bytes go to.
async fn open_at(path: PathBuf, size: u64) -> Result<Target, RpcError> {
    let temp = temp_path(&path);
    let file =
        OpenOptions::new().write(true).create_new(true).open(&temp).await.map_err(io_error)?;
    let received = Received { bytes: 0, size, grants: Grants::default() };
    Ok(Target { path, temp, file, received, own: None })
}

/// The file a symlink points to, so writing through it updates that file (as `cp` does) and the
/// link stays; a path that does not exist yet is used as it is.
async fn real_path(path: &Path) -> Result<PathBuf, RpcError> {
    match tokio::fs::canonicalize(path).await {
        Ok(real) => Ok(real),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(path.to_owned()),
        Err(err) => Err(io_error(err)),
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.isbell-{:016x}.tmp", rand::random::<u64>()))
}

/// Grants credit and stores what arrives; on the writer's end, puts the file in place once all of
/// it arrived. Anything else removes the temporary file and leaves the target as it was.
pub async fn pump_write(
    target: Target,
    input: mpsc::Receiver<Input>,
    mut emit: impl FnMut(Output),
) {
    let Target { path, temp, file, received, own } = target;
    emit(Output::Credit(WINDOW));
    let stored = match receive(file, received, input, &mut emit).await {
        Ok(file) => commit(file, &temp, &path).await,
        Err(err) => Err(err),
    };
    if stored.is_err() {
        remove(&temp).await;
        if let Some(own) = own {
            remove_dir(&own).await;
        }
    }
    emit(Output::End(stored.err()));
}

/// Writes chunks to `file` until the writer's end, granting credit as they are written.
async fn receive(
    mut file: File,
    mut received: Received,
    mut input: mpsc::Receiver<Input>,
    emit: &mut impl FnMut(Output),
) -> Result<File, RpcError> {
    loop {
        let next = tokio::time::timeout(STALLED_FOR, input.recv())
            .await
            .map_err(|_| RpcError::new("idle", "the writer stopped sending"))?;
        match next {
            Some(Input::Chunk(chunk)) => {
                let (next, grant) = received.chunk(chunk.len() as u64)?;
                file.write_all(&chunk).await.map_err(io_error)?;
                received = next;
                if let Some(n) = grant {
                    emit(Output::Credit(n));
                }
            }
            Some(Input::Close) | None => return received.complete().map(|()| file),
            Some(_) => {}
        }
    }
}

/// Makes the bytes durable, keeps the replaced file's permissions, and puts the file in place.
async fn commit(file: File, temp: &Path, path: &Path) -> Result<(), RpcError> {
    file.sync_all().await.map_err(io_error)?;
    match tokio::fs::metadata(path).await {
        Ok(meta) => tokio::fs::set_permissions(temp, meta.permissions()).await.map_err(io_error)?,
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(io_error(err)),
    }
    tokio::fs::rename(temp, path).await.map_err(io_error)
}

async fn remove(temp: &Path) {
    if let Err(err) = tokio::fs::remove_file(temp).await {
        tracing::warn!(%err, temp = %temp.display(), "cannot remove a partial write");
    }
}

async fn remove_dir(dir: &Path) {
    if let Err(err) = tokio::fs::remove_dir(dir).await {
        tracing::warn!(%err, dir = %dir.display(), "cannot remove a failed upload's directory");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn received(size: u64) -> Received {
        Received { bytes: 0, size, grants: Grants::default() }
    }

    #[test]
    fn counts_what_arrived_against_the_announced_size() {
        let half = WINDOW / 2;
        let (after, grant) = received(WINDOW).chunk(half).unwrap();
        assert_eq!(grant, Some(half), "half a window written is granted back");
        assert_eq!(after.complete().unwrap_err().code, "incomplete");
        assert_eq!(after.chunk(half + 1).unwrap_err().code, "size_mismatch");
        let (full, _) = after.chunk(half).unwrap();
        assert!(full.complete().is_ok());
        assert!(received(0).complete().is_ok(), "an empty file is complete at once");
    }

    /// Runs a write of `size` bytes fed with `inputs`; returns everything it emitted.
    async fn write(path: &Path, size: u64, inputs: Vec<Input>) -> Vec<Output> {
        let (target, r) = open_write(json!({"path": path, "size": size})).await.unwrap();
        assert_eq!(r, json!({}));
        let (tx, rx) = mpsc::channel(inputs.len().max(1));
        for input in inputs {
            tx.send(input).await.unwrap();
        }
        let mut out = Vec::new();
        pump_write(target, rx, |o| out.push(o)).await;
        out
    }

    fn names(dir: &Path) -> Vec<String> {
        let entries = std::fs::read_dir(dir).unwrap();
        entries.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
    }

    #[tokio::test]
    async fn replaces_the_target_once_complete_keeping_its_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run.sh");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o750)).unwrap();
        let chunks =
            vec![Input::Chunk(b"echo ".to_vec()), Input::Chunk(b"hi".to_vec()), Input::Close];
        let out = write(&path, 7, chunks).await;
        assert_eq!(out.first(), Some(&Output::Credit(WINDOW)));
        assert_eq!(out.last(), Some(&Output::End(None)));
        assert_eq!(std::fs::read(&path).unwrap(), b"echo hi");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o750);
        assert_eq!(names(dir.path()), ["run.sh"], "no temporary file is left");
    }

    #[tokio::test]
    async fn leaves_the_target_alone_unless_all_of_it_arrived() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, "old").unwrap();
        let ended = |out: Vec<Output>| match out.last() {
            Some(Output::End(Some(err))) => err.code.clone(),
            other => panic!("expected an error end, got {other:?}"),
        };
        let short = write(&path, 10, vec![Input::Chunk(b"new".to_vec()), Input::Close]).await;
        assert_eq!(ended(short), "incomplete");
        let long = write(&path, 2, vec![Input::Chunk(b"new".to_vec())]).await;
        assert_eq!(ended(long), "size_mismatch");
        assert_eq!(std::fs::read(&path).unwrap(), b"old");
        assert_eq!(names(dir.path()), ["notes.md"], "no temporary file is left");
    }

    #[tokio::test]
    async fn writes_through_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let (real, link) = (dir.path().join("real.md"), dir.path().join("link.md"));
        std::fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let out = write(&link, 3, vec![Input::Chunk(b"new".to_vec()), Input::Close]).await;
        assert_eq!(out.last(), Some(&Output::End(None)));
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
    }

    #[test]
    fn an_upload_is_named_by_the_last_part_of_its_name() {
        assert_eq!(upload_name("shot.png"), "shot.png");
        assert_eq!(upload_name("../../etc/x"), "x");
        assert_eq!(upload_name("a\u{7}b.txt"), "ab.txt");
        for nothing in ["", "..", "a/..", "/"] {
            assert_eq!(upload_name(nothing), "file", "{nothing:?}");
        }
    }

    #[tokio::test]
    async fn an_upload_lands_in_a_private_directory_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let uploads = dir.path().join("isbell-uploads");
        let p = json!({"name": "shot.png", "size": 3});
        let (target, r) = open_upload(p, uploads.clone()).await.unwrap();
        let (tx, rx) = mpsc::channel(2);
        tx.send(Input::Chunk(b"png".to_vec())).await.unwrap();
        tx.send(Input::Close).await.unwrap();
        pump_write(target, rx, |_| {}).await;

        let path = PathBuf::from(r["path"].as_str().unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), b"png");
        assert_eq!(path.file_name().unwrap(), "shot.png");
        let own = path.parent().unwrap();
        assert_eq!(own.parent().unwrap(), uploads);
        for d in [uploads.as_path(), own] {
            assert_eq!(std::fs::metadata(d).unwrap().permissions().mode() & 0o777, 0o700);
        }
    }

    #[tokio::test]
    async fn a_failed_upload_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let p = json!({"name": "shot.png", "size": 10});
        let (target, _) = open_upload(p, dir.path().to_owned()).await.unwrap();
        let (tx, rx) = mpsc::channel(2);
        tx.send(Input::Chunk(b"png".to_vec())).await.unwrap();
        tx.send(Input::Close).await.unwrap();
        pump_write(target, rx, |_| {}).await;
        assert!(names(dir.path()).is_empty(), "{:?}", names(dir.path()));
    }

    #[tokio::test]
    async fn refuses_targets_it_cannot_write() {
        let dir = tempfile::tempdir().unwrap();
        let code = async |path: Value| {
            open_write(json!({"path": path, "size": 1})).await.err().unwrap().code
        };
        assert_eq!(code(json!("notes.md")).await, "bad_request");
        assert_eq!(code(json!(dir.path())).await, "not_a_file");
        assert_eq!(code(json!(dir.path().join("missing/notes.md"))).await, "not_found");
    }
}
