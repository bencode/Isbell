//! Listing a directory one level at a time, the way a tree expands it.

use std::fs::DirEntry;

use isbell_proto::frame::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{absolute_path, blocking, read_dir};

/// More than anyone reads in one directory; a listing past it says it was cut.
const MAX_ENTRIES: usize = 2000;

#[derive(Deserialize)]
struct ListRequest {
    path: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Dir,
    File,
    Other,
}

#[derive(Debug, PartialEq, Serialize)]
struct Entry {
    name: String,
    kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

/// The entries of the directory at the absolute `path`, directories first, and whether there were
/// more than MAX_ENTRIES.
pub async fn list(p: Value) -> Result<Value, RpcError> {
    let req: ListRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let path = absolute_path(&req.path)?.to_owned();
    let entries =
        blocking(move || Ok(read_dir(&path)?.map(|entry| entry_of(&entry)).collect())).await?;
    let (entries, truncated) = listing(entries);
    Ok(json!({"entries": entries, "truncated": truncated}))
}

/// A symlink is what it points to, so a link to a directory expands like one; a broken link, or
/// anything neither a directory nor a regular file, is `other`.
fn entry_of(entry: &DirEntry) -> Entry {
    let name = entry.file_name().to_string_lossy().into_owned();
    let (kind, size) = match std::fs::metadata(entry.path()) {
        Ok(meta) if meta.is_dir() => (Kind::Dir, None),
        Ok(meta) if meta.is_file() => (Kind::File, Some(meta.len())),
        _ => (Kind::Other, None),
    };
    Entry { name, kind, size }
}

/// Directories first, then by name regardless of case; at most MAX_ENTRIES, and whether any were
/// left out.
fn listing(mut entries: Vec<Entry>) -> (Vec<Entry>, bool) {
    entries.sort_by_cached_key(|e| (e.kind != Kind::Dir, e.name.to_lowercase(), e.name.clone()));
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    (entries, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[tokio::test]
    async fn lists_directories_first_then_by_name_with_links_as_what_they_point_to() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("B.md"), "hello").unwrap();
        std::fs::write(root.join("a.txt"), "").unwrap();
        std::fs::create_dir(root.join("zdir")).unwrap();
        std::fs::create_dir(root.join("Adir")).unwrap();
        symlink(root.join("zdir"), root.join("link")).unwrap();
        symlink(root.join("missing"), root.join("broken")).unwrap();

        let listed = list(json!({"path": root})).await.unwrap();
        assert_eq!(
            listed,
            json!({"entries": [
                {"name": "Adir", "kind": "dir"},
                {"name": "link", "kind": "dir"},
                {"name": "zdir", "kind": "dir"},
                {"name": "a.txt", "kind": "file", "size": 0},
                {"name": "B.md", "kind": "file", "size": 5},
                {"name": "broken", "kind": "other"},
            ], "truncated": false})
        );
    }

    #[test]
    fn a_long_directory_is_cut_and_says_so() {
        let file = |i: usize| Entry { name: format!("f{i:05}"), kind: Kind::File, size: Some(0) };
        let (entries, truncated) = listing((0..=MAX_ENTRIES).rev().map(file).collect());
        assert!(truncated);
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries.last().unwrap().name, format!("f{:05}", MAX_ENTRIES - 1));
    }

    #[tokio::test]
    async fn refuses_what_it_cannot_list() {
        let code = async |p: Value| list(p).await.err().unwrap().code;
        assert_eq!(code(json!({"path": "docs"})).await, "bad_request");
        assert_eq!(code(json!({})).await, "bad_request");
        assert_eq!(code(json!({"path": "/nonexistent/isbell/dir"})).await, "not_found");
        let file = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(code(json!({"path": file.path()})).await, "not_a_directory");
    }
}
