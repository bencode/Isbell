//! Searching files by path, breadth-first under a root: shallow files come first, and a huge tree
//! (`node_modules`, `target`) ends a search by time, not by its size.

use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};

use super::{absolute_path, blocking, read_dir};

const MAX_RESULTS: usize = 200;
const SEARCH_FOR: Duration = Duration::from_secs(2);
const MAX_QUERY: usize = 200;
/// Never entered: object hashes and refs no one reads, and most of the files of a big repository.
const SKIPPED: &str = ".git";

#[derive(Deserialize)]
struct SearchRequest {
    root: String,
    query: String,
}

/// The files under the absolute `root` whose root-relative path contains `query`, ignoring case,
/// and whether the search stopped before the end of the tree.
pub async fn search(p: Value) -> Result<Value, RpcError> {
    let req: SearchRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let root = absolute_path(&req.root)?.to_owned();
    let needle = needle(&req.query)?;
    let deadline = Instant::now() + SEARCH_FOR;
    let (paths, truncated) = blocking(move || walk(&root, &needle, deadline)).await?;
    Ok(json!({"paths": paths, "truncated": truncated}))
}

fn needle(query: &str) -> Result<String, RpcError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY {
        let msg = format!("the query must be 1..={MAX_QUERY} characters");
        return Err(RpcError::new("bad_request", msg));
    }
    Ok(query.to_lowercase())
}

/// The '/'-separated paths under `root` of the files matching the lower-cased `needle`, and whether
/// the walk stopped at MAX_RESULTS or `deadline`. Symlinks are neither followed nor matched, so the
/// walk cannot loop or leave `root`. Directories wait as paths and are opened in turn, so a wide
/// tree holds one open at a time. A directory that blocks on reading (a hung network mount) holds
/// the walk until it answers; the caller's own timeout bounds the wait.
fn walk(root: &Path, needle: &str, deadline: Instant) -> Result<(Vec<String>, bool), RpcError> {
    let mut dirs = VecDeque::from([String::new()]);
    let mut found = Vec::new();
    while let Some(dir) = dirs.pop_front() {
        // Not `root.join("")`, whose trailing '/' turns a root that is a file into an I/O error.
        let at = if dir.is_empty() { root.to_owned() } else { root.join(&dir) };
        let entries = match read_dir(&at) {
            Ok(entries) => entries,
            // The root's errors are the caller's; a directory inside that cannot be read is skipped.
            Err(err) if dir.is_empty() => return Err(err),
            Err(err) => {
                tracing::debug!(?err, dir, "search skips an unreadable directory");
                continue;
            }
        };
        for entry in entries {
            // Checked for each entry, so one huge directory cannot hold the search past it.
            if Instant::now() >= deadline {
                return Ok((found, true));
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(err) => {
                    tracing::debug!(%err, path, "search skips an entry of unknown type");
                    continue;
                }
            };
            if kind.is_dir() && name != SKIPPED {
                dirs.push_back(path);
            } else if kind.is_file() && path.to_lowercase().contains(needle) {
                if found.len() == MAX_RESULTS {
                    return Ok((found, true));
                }
                found.push(path);
            }
        }
    }
    Ok((found, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tree(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for file in files {
            let path = dir.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        dir
    }

    fn depth(path: &str) -> usize {
        path.matches('/').count()
    }

    fn later() -> Instant {
        Instant::now() + SEARCH_FOR
    }

    #[test]
    fn finds_files_by_any_part_of_their_path_shallow_first() {
        let dir = tree(&[
            "README.md",
            "Design.md",
            "priv/design/home.html",
            "docs/deep/er/design-notes.md",
            ".hidden/design.txt",
            ".git/design-object",
        ]);
        symlink(dir.path().join("priv"), dir.path().join("link")).unwrap();

        let (found, truncated) = walk(dir.path(), "design", later()).unwrap();
        assert!(!truncated);
        assert!(found.windows(2).all(|w| depth(&w[0]) <= depth(&w[1])), "{found:?}");
        let mut sorted = found.clone();
        sorted.sort();
        let expected = [
            ".hidden/design.txt",
            "Design.md",
            "docs/deep/er/design-notes.md",
            "priv/design/home.html",
        ];
        assert_eq!(sorted, expected, "case ignored, a directory name matches; no .git, no link");
    }

    #[test]
    fn stops_at_the_cap_or_the_deadline_and_says_so() {
        let names: Vec<String> = (0..=MAX_RESULTS).map(|i| format!("f{i}.md")).collect();
        let dir = tree(&names.iter().map(String::as_str).collect::<Vec<_>>());
        let (found, truncated) = walk(dir.path(), ".md", later()).unwrap();
        assert_eq!((found.len(), truncated), (MAX_RESULTS, true));
        assert_eq!(walk(dir.path(), ".md", Instant::now()).unwrap(), (vec![], true));
    }

    #[tokio::test]
    async fn refuses_a_bad_query_or_root() {
        let code = async |p: Value| search(p).await.err().unwrap().code;
        let dir = tree(&["a.md"]);
        assert_eq!(code(json!({"root": dir.path(), "query": "  "})).await, "bad_request");
        assert_eq!(
            code(json!({"root": dir.path(), "query": "x".repeat(MAX_QUERY + 1)})).await,
            "bad_request"
        );
        assert_eq!(code(json!({"root": "docs", "query": "a"})).await, "bad_request");
        let file = dir.path().join("a.md");
        assert_eq!(code(json!({"root": file, "query": "a"})).await, "not_a_directory");
        let found = search(json!({"root": dir.path(), "query": " A.MD "})).await.unwrap();
        assert_eq!(found, json!({"paths": ["a.md"], "truncated": false}));
    }
}
