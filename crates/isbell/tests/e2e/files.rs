//! Reading a machine's files through the relay, paced by credit.

use isbell::client::Session;
use isbell_proto::flow::{MAX_CHUNK, WINDOW};

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
