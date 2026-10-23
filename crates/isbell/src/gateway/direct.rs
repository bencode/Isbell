//! A caller's direct link: `isbell.rtc.offer {offer}` is answered with `{answer}`, then the
//! caller's frames on the link are served like relayed ones until the link ends.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::calls::{ToCalls, response_frame};
use super::link::Link;
use crate::rtc::{self, Description, Peer, RtcError};

/// After answering, how long the caller has to open the channel.
const OPEN_WITHIN: Duration = Duration::from_secs(10);

/// Numbers direct links, so their keys never collide with each other or relay connection ids.
static NEXT_LINK: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
struct OfferRequest {
    offer: Description,
}

/// Answers the offer through `link`, then serves the caller over the direct link until it ends;
/// the caller's streams are closed then.
pub async fn serve(
    link: Link,
    id: u64,
    p: Value,
    ice: Vec<String>,
    calls: mpsc::UnboundedSender<ToCalls>,
) {
    let (mut peer, answer) = match answer(p, &ice).await {
        Ok(answered) => answered,
        Err(err) => return link.send(response_frame(id, Err(err))),
    };
    link.send(response_frame(id, Ok(json!({"answer": answer}))));
    let channel = match tokio::time::timeout(OPEN_WITHIN, peer.channel()).await {
        Ok(Ok(channel)) => channel,
        Ok(Err(err)) => return close(peer, &err.to_string()).await,
        Err(_) => return close(peer, "the caller never opened the channel").await,
    };
    let key = format!("peer-{}", NEXT_LINK.fetch_add(1, Ordering::Relaxed));
    let path = peer.path().await.map(|path| path.to_string());
    tracing::info!(caller = key, path, "direct link open");
    let (out, out_rx) = mpsc::unbounded_channel();
    let direct = Link::peer(key.clone(), out);
    rtc::carry(&mut peer, channel, out_rx, |frame| {
        if calls.send(ToCalls::Frame(direct.clone(), Box::new(frame))).is_err() {
            tracing::error!("the calls stopped; dropping a direct frame");
        }
    })
    .await;
    close(peer, "the link ended").await;
    if calls.send(ToCalls::Gone(key)).is_err() {
        tracing::error!("the calls stopped before a direct link ended");
    }
}

async fn answer(p: Value, ice: &[String]) -> Result<(Peer, Description), RpcError> {
    let OfferRequest { offer } =
        serde_json::from_value(p).map_err(|err| RpcError::new("bad_request", err.to_string()))?;
    let mut peer = Peer::answerer(ice).await.map_err(failed)?;
    match peer.answer(offer).await {
        Ok(answer) => Ok((peer, answer)),
        Err(err) => {
            peer.close().await;
            Err(failed(err))
        }
    }
}

async fn close(peer: Peer, why: &str) {
    tracing::info!(why, "direct link closed");
    peer.close().await;
}

fn failed(err: RtcError) -> RpcError {
    RpcError::new("direct_failed", err.to_string())
}
