//! Reading and writing a machine's files through the relay, paced by credit.

use std::path::Path;
use std::time::Duration;

use isbell::client::Session;
use isbell_proto::flow::{MAX_CHUNK, WINDOW};
use serde_json::json;

/// A file larger than the credit window arrives whole and in bounded chunks, so the reader had to
/// grant more credit along the way; bad paths fail before any data.
pub async fn read(session: &Session, mid: &str) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.bin");
    let content: Vec<u8> = (0..3 * WINDOW as usize).map(|_| rand::random::<u8>()).collect();
    std::fs::write(&path, &content).unwrap();

    let mut read = session.read_file(mid, path.to_str().unwrap()).await.unwrap();
    assert_eq!(read.size, content.len() as u64);
    let mut received = Vec::new();
    while let Some(chunk) = read.next().await {
        let chunk = chunk.unwrap();
        assert!(chunk.len() <= MAX_CHUNK);
        received.extend(chunk);
    }
    assert!(received == content, "the file arrives byte for byte");
    assert!(read.next().await.is_none(), "a finished read stays finished");

    let missing = dir.path().join("missing.md");
    let err = session.read_file(mid, missing.to_str().unwrap()).await.err().unwrap();
    assert_eq!(err.code, "not_found");
    let err = session.read_file(mid, "relative.md").await.err().unwrap();
    assert_eq!(err.code, "bad_request");
}

/// A file written in many chunks replaces the target whole; an abandoned or oversized write
/// leaves the target as it was and no temporary file behind.
pub async fn write(session: &Session, mid: &str) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.md");
    let path_str = path.to_str().unwrap();
    let content: Vec<u8> = (0..3 * WINDOW as usize).map(|_| rand::random::<u8>()).collect();

    let mut write = session.write_file(mid, path_str, content.len() as u64).await.unwrap();
    for chunk in content.chunks(MAX_CHUNK) {
        write.send(chunk.to_vec()).await.unwrap();
    }
    write.finish().await.unwrap();
    assert!(std::fs::read(&path).unwrap() == content, "the file arrives byte for byte");

    let mut abandoned = session.write_file(mid, path_str, 10).await.unwrap();
    abandoned.send(b"half".to_vec()).await.unwrap();
    drop(abandoned);
    only_target_left(dir.path(), "notes.md").await;
    assert!(std::fs::read(&path).unwrap() == content, "an abandoned write changes nothing");

    // A write the machine ended fails the sender's next chunks, not only its finish.
    let mut oversized = session.write_file(mid, path_str, 2).await.unwrap();
    let failed = async {
        loop {
            if let Err(err) = oversized.send(b"too long".to_vec()).await {
                return err;
            }
        }
    };
    let err = tokio::time::timeout(Duration::from_secs(5), failed).await.expect("send fails");
    assert_eq!(err.code, "size_mismatch");
    only_target_left(dir.path(), "notes.md").await;
}

/// Waits until the gateway removed its temporary files from `dir`.
async fn only_target_left(dir: &Path, target: &str) {
    let names = || -> Vec<String> {
        let entries = std::fs::read_dir(dir).unwrap();
        entries.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
    };
    let cleaned = async {
        while names() != [target] {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), cleaned)
        .await
        .unwrap_or_else(|_| panic!("temporary files left: {:?}", names()));
}

/// A directory comes back one level at a time, and a nested file is found by part of its path.
pub async fn list_and_search(session: &Session, mid: &str) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("docs/design")).unwrap();
    std::fs::write(dir.path().join("docs/design/home.md"), "# Home").unwrap();
    std::fs::write(dir.path().join("README.md"), "hi").unwrap();

    let listed = session.call(mid, "isbell.file.list", json!({"path": dir.path()}), None).await;
    let entries =
        json!([{"name": "docs", "kind": "dir"}, {"name": "README.md", "kind": "file", "size": 2}]);
    assert_eq!(listed.unwrap(), json!({"entries": entries, "truncated": false}));

    let query = json!({"root": dir.path(), "query": "design/HOME"});
    let found = session.call(mid, "isbell.file.search", query, None).await;
    assert_eq!(found.unwrap(), json!({"paths": ["docs/design/home.md"], "truncated": false}));

    let err =
        session.call(mid, "isbell.file.list", json!({"path": "docs"}), None).await.unwrap_err();
    assert_eq!(err.code, "bad_request");
}
