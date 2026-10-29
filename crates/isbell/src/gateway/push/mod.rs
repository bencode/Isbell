//! Pushes to the phones subscribed on this machine when one of its agents comes to ask or is done,
//! so they hear of it with Isbell closed. Each gateway pushes its own machine's agents; the relay
//! keeps nothing. Only Apple's push service is reached: Isbell's phone is an iPhone.

mod store;
mod vapid;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use isbell_proto::frame::RpcError;
use isbell_proto::identity::Identity;
use isbell_proto::state::{AgentStatus, MachineState};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::watch;
use web_push_native::jwt_simple::algorithms::ES256KeyPair;
use web_push_native::p256::PublicKey;
use web_push_native::{Auth, WebPushBuilder};

use self::store::{Store, Subscription, Texts};

/// How long the push service holds a push for a phone that is off.
const TTL: Duration = Duration::from_secs(60 * 60);
const SEND_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Push {
    store: Store,
    vapid: ES256KeyPair,
    key: String,
    /// Who sends, for the push service: the relay's site.
    subject: String,
    http: reqwest::Client,
}

impl Push {
    pub fn new(identity: &Identity, file: PathBuf, relay: &str) -> Push {
        let vapid = vapid::derive(identity);
        let host = relay.parse::<http::Uri>().ok().and_then(|uri| uri.host().map(str::to_owned));
        Push {
            store: Store::load(file),
            key: vapid::public_key(&vapid),
            vapid,
            subject: format!("https://{}", host.as_deref().unwrap_or("isbell.fmap.dev")),
            http: reqwest::Client::builder().timeout(SEND_TIMEOUT).build().expect("an HTTP client"),
        }
    }

    /// `isbell.push.key`: the public key phones subscribe with.
    pub fn key(&self) -> Value {
        json!({ "key": self.key })
    }

    /// `isbell.push.subscribe`: keeps a phone's subscription, replacing the one for its endpoint.
    pub fn subscribe(&self, p: Value) -> Result<Value, RpcError> {
        let req: SubscribeRequest = serde_json::from_value(p).map_err(RpcError::bad_request)?;
        let sub = req.checked().map_err(RpcError::bad_request)?;
        self.store.put(sub).map_err(|err| RpcError::new("io_error", err.to_string()))?;
        Ok(json!({}))
    }

    /// Tells each subscribed phone of `notice`, dropping the subscriptions the push service no
    /// longer knows (the phone turned pushes off, or Isbell was removed from it).
    async fn send(self: Arc<Self>, notice: Notice) {
        for sub in self.store.all() {
            match self.deliver(&sub, &notice).await {
                Ok(true) => {}
                Ok(false) => {
                    tracing::info!(endpoint = %sub.endpoint, "a phone unsubscribed; forgetting it");
                    let push = Arc::clone(&self);
                    // Off the runtime: forgetting it writes a file.
                    match tokio::task::spawn_blocking(move || push.store.remove(&sub.endpoint))
                        .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(err)) => tracing::error!(%err, "cannot forget a push subscription"),
                        Err(err) => tracing::error!(%err, "forgetting a push subscription failed"),
                    }
                }
                Err(err) => tracing::warn!(endpoint = %sub.endpoint, %err, "push not delivered"),
            }
        }
    }

    /// Whether the push service still knows `sub`.
    async fn deliver(&self, sub: &Subscription, notice: &Notice) -> Result<bool, String> {
        let p256dh = URL_SAFE_NO_PAD.decode(&sub.p256dh).map_err(|err| err.to_string())?;
        let auth = URL_SAFE_NO_PAD.decode(&sub.auth).map_err(|err| err.to_string())?;
        let request = WebPushBuilder::new(
            sub.endpoint.parse().map_err(|err: http::uri::InvalidUri| err.to_string())?,
            PublicKey::from_sec1_bytes(&p256dh).map_err(|err| err.to_string())?,
            Auth::clone_from_slice(&auth),
        )
        .with_valid_duration(TTL)
        .with_vapid(&self.vapid, &self.subject)
        .build(notice.payload(&sub.texts).to_string())
        .map_err(|err| err.to_string())?;
        let request = reqwest::Request::try_from(request).map_err(|err| err.to_string())?;
        let response = self.http.execute(request).await.map_err(|err| err.to_string())?;
        match response.status().as_u16() {
            404 | 410 => Ok(false),
            _ if response.status().is_success() => Ok(true),
            status => {
                let body =
                    response.text().await.unwrap_or_else(|err| format!("(body unreadable: {err})"));
                Err(format!("{status}: {body}"))
            }
        }
    }
}

#[derive(Deserialize)]
struct SubscribeRequest {
    endpoint: String,
    keys: Keys,
    texts: Texts,
}

#[derive(Deserialize)]
struct Keys {
    p256dh: String,
    auth: String,
}

impl SubscribeRequest {
    fn checked(self) -> Result<Subscription, String> {
        let uri: http::Uri = self.endpoint.parse().map_err(|_| "endpoint is not a URL")?;
        // Apple's alone: pushes go to no other host, however a caller fills this in.
        let apple = uri.scheme_str() == Some("https")
            && uri.host().is_some_and(|host| host.ends_with(".push.apple.com"));
        if !apple {
            return Err("pushes go to Apple's push service only".into());
        }
        let p256dh =
            URL_SAFE_NO_PAD.decode(&self.keys.p256dh).map_err(|_| "p256dh is not base64url")?;
        PublicKey::from_sec1_bytes(&p256dh).map_err(|_| "p256dh is not a P-256 public key")?;
        let auth = URL_SAFE_NO_PAD.decode(&self.keys.auth).map_err(|_| "auth is not base64url")?;
        if auth.len() != 16 {
            return Err("auth is not 16 bytes".into());
        }
        if self.texts.blocked.is_empty() || self.texts.done.is_empty() {
            return Err("texts are empty".into());
        }
        Ok(Subscription {
            endpoint: self.endpoint,
            p256dh: self.keys.p256dh,
            auth: self.keys.auth,
            texts: self.texts,
        })
    }
}

/// An agent come to ask or done.
#[derive(Debug, PartialEq)]
struct Notice {
    mid: String,
    pane_id: String,
    name: String,
    blocked: bool,
    /// Where it is: its project and machine.
    place: String,
}

impl Notice {
    /// What the service worker shows, and the session a tap opens.
    fn payload(&self, texts: &Texts) -> Value {
        let title = if self.blocked { &texts.blocked } else { &texts.done };
        json!({
            "title": title.replace("{name}", &self.name),
            "body": self.place,
            "tag": format!("{}/{}", self.mid, self.pane_id),
            "url": format!("/s/{}/{}", self.mid, self.pane_id.replace(':', "%3A")),
        })
    }
}

type Seen = HashMap<String, AgentStatus>;

fn seen(state: &MachineState) -> Seen {
    state.agents.iter().map(|a| (a.pane_id.clone(), a.status)).collect()
}

/// The agents of `now` that came to ask or finished since `before`. One not in `before` is not
/// told of, so a herdr that restarts does not tell again of every agent it finds done.
fn due(before: &Seen, now: &MachineState) -> Vec<Notice> {
    now.agents
        .iter()
        .filter(|a| matches!(a.status, AgentStatus::Blocked | AgentStatus::Done))
        .filter(|a| before.get(&a.pane_id).is_some_and(|was| *was != a.status))
        .map(|a| {
            let project = a.cwd.as_deref().and_then(|cwd| cwd.rsplit('/').find(|s| !s.is_empty()));
            Notice {
                mid: now.machine.id.clone(),
                pane_id: a.pane_id.clone(),
                name: a.name.clone().or_else(|| a.kind.clone()).unwrap_or_else(|| "agent".into()),
                blocked: a.status == AgentStatus::Blocked,
                place: [project, Some(now.machine.name.as_str())]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" · "),
            }
        })
        .collect()
}

/// Watches the machine's state and pushes what is due. The first state is only where it starts
/// from: what was already asking or done when the gateway started is not news.
pub async fn run(push: Arc<Push>, mut states: watch::Receiver<Option<MachineState>>) {
    let mut before: Option<Seen> = None;
    while states.changed().await.is_ok() {
        let Some(state) = states.borrow_and_update().clone() else { continue };
        if let Some(before) = &before {
            for notice in due(before, &state) {
                // Sent aside, so a slow push service never holds up the next state.
                tokio::spawn(Arc::clone(&push).send(notice));
            }
        }
        before = Some(seen(&state));
    }
}

#[cfg(test)]
mod tests {
    use isbell_proto::state::{Agent, Caps, HerdrState, HerdrStatus, MachineInfo};

    use super::*;

    fn agent(pane_id: &str, status: AgentStatus) -> Agent {
        Agent {
            pane_id: pane_id.into(),
            name: None,
            kind: Some("codex".into()),
            status,
            status_since: 0,
            cwd: Some("/Users/me/work/goat".into()),
            title: None,
        }
    }

    fn state(agents: Vec<Agent>) -> MachineState {
        MachineState {
            machine: MachineInfo {
                id: "e339299e0679d6bb".into(),
                name: "Mac-mini".into(),
                hostname: "mini".into(),
                os: "macos".into(),
                version: "0".into(),
            },
            boot: 0,
            rev: 0,
            herdr: HerdrState { status: HerdrStatus::Ready, version: None, protocol: None },
            caps: Caps { methods: vec![], agent_kinds: vec![] },
            agents,
        }
    }

    #[test]
    fn an_agent_is_told_of_as_it_comes_to_ask_or_finishes() {
        use AgentStatus::*;
        let before = seen(&state(vec![
            agent("w1:p1", Working),
            agent("w2:p1", Working),
            agent("w3:p1", Done),
        ]));
        let now = state(vec![
            agent("w1:p1", Blocked),
            agent("w2:p1", Done),
            agent("w3:p1", Done),
            agent("w4:p1", Done),
        ]);
        let told: Vec<_> = due(&before, &now).into_iter().map(|n| (n.pane_id, n.blocked)).collect();
        assert_eq!(
            told,
            [("w1:p1".to_owned(), true), ("w2:p1".to_owned(), false)],
            "not again, nor a new one"
        );
        assert!(due(&seen(&now), &state(vec![agent("w1:p1", Working)])).is_empty(), "nor at work");

        let texts = Texts { blocked: "{name} asks".into(), done: "{name} is done".into() };
        let payload = due(&before, &now)[0].payload(&texts);
        assert_eq!(
            payload,
            json!({
                "title": "codex asks",
                "body": "goat · Mac-mini",
                "tag": "e339299e0679d6bb/w1:p1",
                "url": "/s/e339299e0679d6bb/w1%3Ap1",
            })
        );
    }

    #[test]
    fn pushes_go_to_apple_alone() {
        let dir = tempfile::tempdir().unwrap();
        let push = Push::new(
            &Identity::generate(),
            dir.path().join("push.json"),
            "wss://isbell.fmap.dev/ws",
        );
        let key = URL_SAFE_NO_PAD.encode(
            PublicKey::from_sec1_bytes(&URL_SAFE_NO_PAD.decode(&push.key).unwrap())
                .unwrap()
                .to_sec1_bytes(),
        );
        let request = |endpoint: &str| {
            json!({
                "endpoint": endpoint,
                "keys": { "p256dh": key, "auth": URL_SAFE_NO_PAD.encode([7u8; 16]) },
                "texts": { "blocked": "{name} asks", "done": "{name} is done" },
            })
        };
        assert!(push.subscribe(request("https://web.push.apple.com/QGuQyavXutnMH")).is_ok());
        for elsewhere in [
            "https://fcm.googleapis.com/fcm/send/x",
            "http://web.push.apple.com/x",
            "https://push.apple.com.evil.example/x",
        ] {
            assert_eq!(
                push.subscribe(request(elsewhere)).unwrap_err().code,
                "bad_request",
                "{elsewhere}"
            );
        }
        assert_eq!(push.store.all().len(), 1);
    }
}
