//! A caller's direct link: `isbell.rtc.offer {offer, pieces?}` is answered with
//! `{answer, pieces?}`, pieces agreed only when the caller asked; then the caller's frames on the
//! link are served like relayed ones until the link ends.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use isbell_proto::frame::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::calls::{ToCalls, response_frame};
use super::link::Link;
use crate::rtc::{self, Description, Peer};

/// After answering, how long the caller has to open the channel.
const OPEN_WITHIN: Duration = Duration::from_secs(10);

/// Numbers direct links, so their keys never collide with each other or relay connection ids.
static NEXT_LINK: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
struct OfferRequest {
    offer: Description,
    /// The caller puts frames back together from pieces, so long ones may go to it that way.
    #[serde(default)]
    pieces: bool,
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
    let OfferRequest { offer, pieces } = match serde_json::from_value(p) {
        Ok(req) => req,
        Err(err) => return link.send(response_frame(id, Err(RpcError::bad_request(err)))),
    };
    let (mut peer, answer) = match answer(offer, &ice).await {
        Ok(answered) => answered,
        Err(err) => return link.send(response_frame(id, Err(err))),
    };
    let answered =
        if pieces { json!({"answer": answer, "pieces": true}) } else { json!({"answer": answer}) };
    link.send(response_frame(id, Ok(answered)));
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
    rtc::carry(&mut peer, channel, out_rx, pieces, |frame| {
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

async fn answer(offer: Description, ice: &[String]) -> Result<(Peer, Description), RpcError> {
    let offered = rtc::tally(&offer.sdp);
    let mut peer = Peer::answerer(ice).await?;
    match peer.answer(offer).await {
        Ok(answer) => {
            tracing::info!(
                offer = offered,
                answer = rtc::tally(&answer.sdp),
                "answered a direct link"
            );
            Ok((peer, answer))
        }
        Err(err) => {
            peer.close().await;
            Err(err.into())
        }
    }
}

async fn close(peer: Peer, why: &str) {
    tracing::info!(why, states = peer.states(), "direct link closed");
    peer.close().await;
}
