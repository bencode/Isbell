//! The worktrees of a repository, so a project's files can be browsed in each: read from git's
//! machine-readable listing, never by reading `.git` itself, and nothing is ever changed.

use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::file::absolute_path;

const LIST_TIMEOUT: Duration = Duration::from_secs(5);
/// How git exits outside a repository.
const NOT_A_REPOSITORY: i32 = 128;

#[derive(Deserialize)]
struct WorktreesRequest {
    path: String,
}

#[derive(Debug, PartialEq, Serialize)]
struct Worktree {
    /// As git prints it.
    path: String,
    /// `None` for a detached HEAD.
    branch: Option<String>,
    /// The directory asked about.
    here: bool,
}

/// The worktrees of the repository whose worktree root is the absolute `path`: none when `path` is
/// not such a root, is not in a repository, or git is not installed.
pub async fn worktrees(p: Value) -> Result<Value, RpcError> {
    let req: WorktreesRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let path = absolute_path(&req.path)?;
    let listed = match list(&path).await? {
        Some(stdout) => parse(&stdout),
        None => Vec::new(),
    };
    let here = tokio::fs::canonicalize(&path).await.ok();
    let mut found = Vec::new();
    for (path, branch) in listed {
        // A worktree whose directory cannot be resolved is not there to browse.
        let Ok(real) = tokio::fs::canonicalize(&path).await else { continue };
        found.push(Worktree { here: Some(&real) == here.as_ref(), path, branch });
    }
    // A subdirectory of a worktree, or a bare repository, is listed by none of them.
    if !found.iter().any(|w| w.here) {
        found.clear();
    }
    Ok(json!({"worktrees": found}))
}

/// `git worktree list --porcelain -z` run in `dir`; `None` outside a repository or without git.
async fn list(dir: &Path) -> Result<Option<String>, RpcError> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["worktree", "list", "--porcelain", "-z"])
        .kill_on_drop(true)
        .output();
    let output = match tokio::time::timeout(LIST_TIMEOUT, output).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) if err.kind() == ErrorKind::NotFound => {
            tracing::debug!("git is not installed; no worktrees to list");
            return Ok(None);
        }
        Ok(Err(err)) => return Err(RpcError::new("git_failed", err.to_string())),
        Err(_) => return Err(RpcError::new("timeout", "git worktree list timed out")),
    };
    match output.status.code() {
        Some(0) => Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned())),
        Some(NOT_A_REPOSITORY) => Ok(None),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            Err(RpcError::new(
                "git_failed",
                format!("git worktree list: {}: {stderr}", output.status),
            ))
        }
    }
}

/// The path and branch of each record git lists, leaving out a bare repository and a worktree whose
/// directory is gone (prunable). Records end in an empty field; fields are NUL-terminated.
fn parse(stdout: &str) -> Vec<(String, Option<String>)> {
    stdout
        .split("\0\0")
        .filter_map(|record| {
            let fields: Vec<&str> = record.split('\0').filter(|f| !f.is_empty()).collect();
            let path = fields.iter().find_map(|f| f.strip_prefix("worktree "))?;
            let skipped = fields.iter().any(|f| *f == "bare" || f.starts_with("prunable"));
            let branch = fields.iter().find_map(|f| f.strip_prefix("branch "));
            let branch = branch.map(|b| b.strip_prefix("refs/heads/").unwrap_or(b).to_owned());
            (!skipped).then(|| (path.to_owned(), branch))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn records_are_read_and_the_unbrowsable_left_out() {
        let stdout = [
            "worktree /w/main\0HEAD 1a\0branch refs/heads/main\0",
            "worktree /w/a b\0HEAD 2b\0branch refs/heads/feat/x\0",
            "worktree /w/loose\0HEAD 3c\0detached\0",
            "worktree /w/bare\0bare\0",
            "worktree /w/gone\0HEAD 4d\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0",
        ]
        .join("\0");
        assert_eq!(
            parse(&stdout),
            [
                ("/w/main".to_owned(), Some("main".to_owned())),
                ("/w/a b".to_owned(), Some("feat/x".to_owned())),
                ("/w/loose".to_owned(), None),
            ]
        );
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=isbell", "-c", "user.email=isbell@example.com"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    async fn listed(path: &Path) -> Value {
        worktrees(json!({"path": path})).await.unwrap()["worktrees"].clone()
    }

    #[tokio::test]
    async fn a_repository_lists_its_worktrees_from_its_root_only() {
        let dir = tempfile::tempdir().unwrap();
        let (main, other) = (dir.path().join("main"), dir.path().join("other"));
        std::fs::create_dir_all(main.join("sub")).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["commit", "-q", "--allow-empty", "-m", "start"]);
        git(&main, &["worktree", "add", "-q", "-b", "feat/x", other.to_str().unwrap()]);

        let found = listed(&main).await;
        let found = found.as_array().unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!((&found[0]["branch"], &found[0]["here"]), (&json!("main"), &json!(true)));
        assert_eq!((&found[1]["branch"], &found[1]["here"]), (&json!("feat/x"), &json!(false)));
        // Asked from the other worktree, that one is here.
        assert_eq!(listed(&other).await[1]["here"], json!(true));

        assert_eq!(listed(&main.join("sub")).await, json!([]));
        let outside = tempfile::tempdir().unwrap();
        assert_eq!(listed(outside.path()).await, json!([]));
    }
}
