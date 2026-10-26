//! Listing a directory one level at a time, the way a tree expands it.

use std::fs::DirEntry;

use isbell_proto::frame::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{absolute_path, blocking, mtime_ms, read_dir};

/// More than anyone reads in one directory; a listing past it says it was cut.
const MAX_ENTRIES: usize = 2000;
/// A listing stays well under the relay's 1 MiB message, however long the names.
const MAX_BYTES: usize = 512 << 10;

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
    /// Milliseconds since the epoch, where the system keeps it.
    #[serde(skip_serializing_if = "Option::is_none")]
    mtime: Option<u64>,
}

/// The entries of the directory at the absolute `path`, directories first; how many it has in all,
/// and whether some were left out.
pub async fn list(p: Value) -> Result<Value, RpcError> {
    let req: ListRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let path = absolute_path(&req.path)?.to_owned();
    let entries =
        blocking(move || Ok(read_dir(&path)?.map(|entry| entry_of(&entry)).collect())).await?;
    let (entries, total) = listing(entries);
    Ok(json!({"entries": entries, "total": total, "truncated": entries.len() < total}))
}

/// A symlink is what it points to, so a link to a directory expands like one; a broken link, or
/// anything neither a directory nor a regular file, is `other`.
fn entry_of(entry: &DirEntry) -> Entry {
    let name = entry.file_name().to_string_lossy().into_owned();
    let meta = std::fs::metadata(entry.path());
    let (kind, size) = match &meta {
        Ok(meta) if meta.is_dir() => (Kind::Dir, None),
        Ok(meta) if meta.is_file() => (Kind::File, Some(meta.len())),
        _ => (Kind::Other, None),
    };
    Entry { name, kind, size, mtime: meta.ok().as_ref().and_then(mtime_ms) }
}

/// Directories first, then by name regardless of case; at most MAX_ENTRIES within MAX_BYTES, and
/// how many there were in all.
fn listing(mut entries: Vec<Entry>) -> (Vec<Entry>, usize) {
    entries.sort_by_cached_key(|e| (e.kind != Kind::Dir, e.name.to_lowercase(), e.name.clone()));
    let fit = entries
        .iter()
        // Each entry as it goes out, escapes and all, and the comma after it; one that cannot be
        // written fills the rest.
        .scan(0, |bytes, e| {
            *bytes += serde_json::to_vec(e).map_or(MAX_BYTES, |json| json.len() + 1);
            Some(*bytes)
        })
        .take(MAX_ENTRIES)
        .take_while(|&bytes| bytes <= MAX_BYTES)
        .count();
    let total = entries.len();
    entries.truncate(fit);
    (entries, total)
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

        let mut listed = list(json!({"path": root})).await.unwrap();
        // Times vary, so each is checked for being there (not for a broken link) and then dropped.
        for entry in listed["entries"].as_array_mut().unwrap() {
            let mtime = entry.as_object_mut().unwrap().remove("mtime");
            assert_eq!(mtime.is_some(), entry["name"] != "broken", "{entry}");
        }
        assert_eq!(
            listed,
            json!({"entries": [
                {"name": "Adir", "kind": "dir"},
                {"name": "link", "kind": "dir"},
                {"name": "zdir", "kind": "dir"},
                {"name": "a.txt", "kind": "file", "size": 0},
                {"name": "B.md", "kind": "file", "size": 5},
                {"name": "broken", "kind": "other"},
            ], "total": 6, "truncated": false})
        );
    }

    #[test]
    fn a_long_directory_is_cut_and_says_so() {
        let file = |i: usize| Entry {
            name: format!("f{i:05}"),
            kind: Kind::File,
            size: Some(0),
            mtime: Some(0),
        };
        let (entries, total) = listing((0..=MAX_ENTRIES).rev().map(file).collect());
        assert_eq!((entries.len(), total), (MAX_ENTRIES, MAX_ENTRIES + 1));
        assert_eq!(entries.last().unwrap().name, format!("f{:05}", MAX_ENTRIES - 1));

        // Long names fill the answer before the count does.
        let long = |i: usize| Entry {
            name: format!("{i:04}\"{}", "名".repeat(80)),
            kind: Kind::File,
            size: None,
            mtime: None,
        };
        let (entries, total) = listing((0..MAX_ENTRIES).map(long).collect());
        assert!(entries.len() < total);
        assert!(serde_json::to_vec(&entries).unwrap().len() <= MAX_BYTES);
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
