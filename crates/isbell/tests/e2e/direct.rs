//! The machine's files and terminals over a direct link instead of the relay: the same checks, and
//! uploads no longer paced for the relay. Abandoned and oversized writes are the gateway's own
//! logic, checked over the relay; flooding a direct link with tiny chunks after the machine ended a
//! write would only queue frames behind it.

use std::time::{Duration, Instant};

use isbell::client::Session;
use isbell_proto::flow::{MAX_CHUNK, WINDOW};
use serde_json::json;

use crate::harness::Harness;
use crate::{checks, files};

const OPEN: Duration = Duration::from_secs(10);

pub async fn serves_streams(harness: &Harness) {
    let mid = &harness.machine.id;
    let session = Session::connect(&harness.url, &harness.id).await.unwrap();
    let path = session.direct(mid, &[]).await.unwrap().expect("the way the new link goes");
    // Without STUN servers both ends only have their local addresses.
    assert!(path.local.starts_with("host ") && path.remote.starts_with("host "), "{path}");

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("small.md");
    std::fs::write(&path, b"# hi").unwrap();
    let read = json!({"path": path});
    let (_, stream) = session.open_stream(mid, "isbell.file.read", read, OPEN).await.unwrap();
    assert!(stream.is_direct(), "streams use the direct link once it is open");
    drop(stream);

    files::read(&session, mid).await;
    checks::terminal_control(&session, mid, &harness.terminal_log).await;
    unpaced_upload(&session, mid).await;
}

/// A file written whole over the direct link. Over the relay, 10 MiB in chunks paced 25ms apart
/// take 4s; a direct link takes them as fast as credit allows, well within half of that.
async fn unpaced_upload(session: &Session, mid: &str) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fast.bin");
    let content = vec![7u8; 10 * WINDOW as usize];
    let started = Instant::now();
    let mut write =
        session.write_file(mid, path.to_str().unwrap(), content.len() as u64).await.unwrap();
    for chunk in content.chunks(MAX_CHUNK) {
        write.send(chunk.to_vec()).await.unwrap();
    }
    write.finish().await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(2), "took {:?}", started.elapsed());
    assert!(std::fs::read(&path).unwrap() == content);
}
