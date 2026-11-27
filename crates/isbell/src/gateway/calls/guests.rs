//! What an agent share's guests reach: the agents shared, by their panes, and nothing else. They
//! talk with them as the user would (prompts, keys, the screen, the conversation as the agent keeps
//! it, the terminal, files sent for them) but start, close or read nothing else. Anyone with the
//! link can send frames here, so calls are allowed by name, and each is held to the panes shared as
//! they are when it comes; a pane is named by its id, never by an agent's name, which could be
//! another's.

use std::path::{Path, PathBuf};

use isbell_proto::frame::{Frame, RpcError};
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use super::ToCalls;
use super::route::{Inbound, Method, response_frame, route};
use super::streams::{Emit, MAX_STREAMS, Streams, close_caller, feed, register, serve_stream};
use crate::book::live;
use crate::gateway::herdr::{Herdr, HerdrError, REQUEST_TIMEOUT};
use crate::gateway::link::Link;
use crate::gateway::stream::Input;
use crate::gateway::{HerdrSlot, direct, file, rpc, terminal};

/// The herdr methods a guest may call, each on a pane shared.
const HERDR_METHODS: &[&str] =
    &["agent.get", "agent.read", "agent.prompt", "agent.wait", "agent.send_keys", "pane.read"];
const OWN_METHODS: [Method; 4] =
    [Method::Terminal, Method::FileRead, Method::FileUpload, Method::RtcOffer];
/// The session a pane shared runs: asked of a share's machine alone, so not one of the gateway's
/// own methods, which its owner's space is served.
const SESSION: &str = "isbell.agentShare.session";

/// The largest file a guest may send, as the web takes for anyone (`UPLOAD_MAX`): the owner's own
/// uploads are not held to it, but anyone with the link can send one.
const GUEST_UPLOAD_MAX: u64 = 20 * 1024 * 1024;

/// Methods a share's machine advertises.
pub fn methods() -> Vec<String> {
    let own = OWN_METHODS.map(Method::name);
    HERDR_METHODS.iter().chain(own.iter()).chain([&SESSION]).map(|m| (*m).to_owned()).collect()
}

/// Owns a share's calls: relayed and direct frames both reach it through its inbox.
pub async fn run(mut guests: Guests, mut inbox: mpsc::UnboundedReceiver<ToCalls>) {
    while let Some(message) = inbox.recv().await {
        guests.reap();
        match message {
            ToCalls::Frame(link, frame) => guests.handle(link, *frame),
            ToCalls::Gone(key) => close_caller(&guests.streams, &key),
        }
    }
}

pub struct Guests {
    tasks: JoinSet<()>,
    streams: Streams,
    slot: HerdrSlot,
    /// The panes shared, as the owner changes them.
    panes: watch::Receiver<Vec<String>>,
    /// Where the agent hook keeps its session records (`~/.isbell/sessions`).
    records: Option<PathBuf>,
    /// Where files sent for the agents go, as the owner's own uploads do.
    uploads: PathBuf,
    /// STUN servers for direct links.
    ice: Vec<String>,
    /// Its own inbox, so that a direct link's frames are held to the same rules.
    inbox: mpsc::UnboundedSender<ToCalls>,
}

impl Guests {
    pub fn new(
        slot: HerdrSlot,
        panes: watch::Receiver<Vec<String>>,
        records: Option<PathBuf>,
        uploads: PathBuf,
        ice: Vec<String>,
        inbox: mpsc::UnboundedSender<ToCalls>,
    ) -> Guests {
        Guests {
            tasks: JoinSet::new(),
            streams: Streams::default(),
            slot,
            panes,
            records,
            uploads,
            ice,
            inbox,
        }
    }

    fn handle(&mut self, link: Link, frame: Frame) {
        match route(frame) {
            Inbound::Call { id, method: Ok(method), p } => {
                match allowed(method, &p, &self.shared()) {
                    Ok(()) => self.start(link, id, method, p),
                    Err(refused) => link.send(response_frame(id, Err(refused))),
                }
            }
            Inbound::Call { id, method: Err(name), p } if name == SESSION => {
                match on_shared(&p["paneId"], &self.shared()) {
                    Ok(()) => self.session(link, id, p),
                    Err(refused) => link.send(response_frame(id, Err(refused))),
                }
            }
            Inbound::Call { id, .. } => link.send(response_frame(id, Err(not_allowed()))),
            Inbound::Input { id, input } => feed(&self.streams, (link.key().to_owned(), id), input),
            Inbound::Ignore(what) => tracing::debug!(what, "ignoring a frame from a guest"),
        }
    }

    fn reap(&mut self) {
        while let Some(joined) = self.tasks.try_join_next() {
            if let Err(err) = joined {
                tracing::error!(%err, "agent share task failed");
            }
        }
    }

    fn shared(&self) -> Vec<String> {
        self.panes.borrow().clone()
    }

    /// Starts a call `allowed` let through.
    fn start(&mut self, link: Link, id: u64, method: Method, p: Value) {
        let herdr = self.herdr();
        match method {
            Method::Herdr => {
                self.tasks.spawn(async move {
                    let result = async { rpc::passthrough(&herdr?, p).await }.await;
                    link.send(response_frame(id, result));
                });
            }
            Method::Terminal => {
                let open = async move { terminal::open(&herdr?, p).await };
                self.stream(link, id, open, terminal::pump);
            }
            Method::FileRead => {
                let (panes, records) = (self.shared(), self.records.clone());
                let open = async move {
                    let p = transcript_only(&herdr?, &panes, records.as_deref(), p).await?;
                    file::open_read(p).await
                };
                self.stream(link, id, open, file::pump_read);
            }
            Method::FileUpload => {
                let open = file::open_upload(p, self.uploads.clone());
                self.stream(link, id, open, file::pump_write);
            }
            Method::RtcOffer => {
                let (ice, inbox) = (self.ice.clone(), self.inbox.clone());
                self.tasks.spawn(direct::serve(link, id, p, ice, inbox));
            }
            _ => link.send(response_frame(id, Err(not_allowed()))),
        }
    }

    /// Answers SESSION for the pane in `p`, which `on_shared` let through.
    fn session(&mut self, link: Link, id: u64, p: Value) {
        let (herdr, records) = (self.herdr(), self.records.clone());
        self.tasks.spawn(async move {
            let result = async {
                let pane = p["paneId"].as_str().unwrap_or_default();
                session_of(&herdr?, pane, records.as_deref()).await
            }
            .await;
            link.send(response_frame(id, result));
        });
    }

    fn herdr(&self) -> Result<Herdr, RpcError> {
        let herdr = self.slot.read().expect("herdr slot poisoned").clone();
        herdr
            .ok_or_else(|| RpcError::from(HerdrError::unavailable("herdr server is not available")))
    }

    /// As `Calls::stream`: registered now, in order with the caller's other frames.
    fn stream<S, R>(
        &mut self,
        link: Link,
        id: u64,
        open: impl Future<Output = Result<(S, Value), RpcError>> + Send + 'static,
        run: impl FnOnce(S, mpsc::Receiver<Input>, Emit) -> R + Send + 'static,
    ) where
        S: Send + 'static,
        R: Future<Output = ()> + Send + 'static,
    {
        match register(&self.streams, (link.key().to_owned(), id), MAX_STREAMS) {
            Ok(slot) => {
                self.tasks.spawn(serve_stream(link, id, slot, open, run));
            }
            Err(err) => link.send(response_frame(id, Err(err))),
        }
    }
}

fn not_allowed() -> RpcError {
    RpcError::new("method_not_allowed", "a share only talks with the agents shared")
}

/// Whether a guest may make the call, on the panes `shared` now. A file read is held to the
/// conversations of those panes later, once herdr says which they are.
fn allowed(method: Method, p: &Value, shared: &[String]) -> Result<(), RpcError> {
    match method {
        Method::Herdr => {
            let name = p["method"].as_str().unwrap_or_default();
            if !HERDR_METHODS.contains(&name) {
                return Err(not_allowed());
            }
            let params = &p["params"];
            let pane = if name == "pane.read" { &params["pane_id"] } else { &params["target"] };
            on_shared(pane, shared)
        }
        Method::Terminal if p["new"].is_null() => on_shared(&p["target"], shared),
        // An upload lands in a directory of its own under the uploads one, by its name's last part.
        Method::FileUpload if p["size"].as_u64().is_some_and(|size| size > GUEST_UPLOAD_MAX) => {
            Err(RpcError::new("too_large", "a share takes files of at most 20 MB"))
        }
        Method::FileRead | Method::FileUpload | Method::RtcOffer => Ok(()),
        _ => Err(not_allowed()),
    }
}

/// Whether `pane`, by its id, is one of the panes `shared` now.
fn on_shared(pane: &Value, shared: &[String]) -> Result<(), RpcError> {
    let pane = pane.as_str().unwrap_or_default();
    if shared.iter().any(|s| s == pane) {
        Ok(())
    } else {
        Err(RpcError::new("not_shared", "that pane is not shared"))
    }
}

/// `p` for reading the file it names, if that is the conversation of one of `panes`: with the
/// file's real path, so that what is read is what was checked.
async fn transcript_only(
    herdr: &Herdr,
    panes: &[String],
    records: Option<&Path>,
    mut p: Value,
) -> Result<Value, RpcError> {
    let path = p["path"].as_str().unwrap_or_default();
    let wanted = tokio::fs::canonicalize(path).await.ok();
    for pane in panes {
        let Ok(session) = session_of(herdr, pane, records).await else { continue };
        let Some(kept) = session["transcript"].as_str() else { continue };
        let kept = tokio::fs::canonicalize(kept).await.ok();
        if let (Some(wanted), Some(kept)) = (&wanted, kept)
            && *wanted == kept
        {
            p["path"] = json!(kept);
            return Ok(p);
        }
    }
    Err(RpcError::new("not_shared", "a share reads only the conversations of the agents shared"))
}

/// The session the agent in `pane` runs, and the file it keeps its conversation in where known:
/// recorded by the agent hook, else the file herdr found it kept in.
async fn session_of(herdr: &Herdr, pane: &str, records: Option<&Path>) -> Result<Value, RpcError> {
    let got = herdr.request("agent.get", json!({"target": pane}), Some(REQUEST_TIMEOUT)).await?;
    let info = &got["agent"];
    let live = live::live_of(info)
        .ok_or_else(|| RpcError::new("no_session", "no session is known to run there"))?;
    let agent = live.agent.as_str();
    let recorded = match records {
        Some(dir) => {
            let (dir, agent, id) = (dir.to_owned(), agent.to_owned(), live.session.clone());
            tokio::task::spawn_blocking(move || recorded_transcript(&dir, &agent, &id))
                .await
                .map_err(|err| RpcError::new("io_error", err.to_string()))?
        }
        None => None,
    };
    // Herdr's account of the session may be of an agent that ran in the pane before.
    let found = &info["agent_session"];
    let herdrs = (found["agent"].as_str() == Some(agent) && found["kind"].as_str() == Some("path"))
        .then(|| found["value"].as_str().map(str::to_owned))
        .flatten();
    Ok(json!({"agent": agent, "id": live.session, "transcript": recorded.or(herdrs)}))
}

/// The transcript the agent hook recorded for the session, in whichever project it is kept:
/// `<records>/<project>/sessions/<agent>-<id>.json`.
fn recorded_transcript(records: &Path, agent: &str, id: &str) -> Option<String> {
    let name = format!("{agent}-{id}.json");
    let projects = std::fs::read_dir(records).ok()?;
    projects.flatten().find_map(|project| {
        let text = std::fs::read_to_string(project.path().join("sessions").join(&name)).ok()?;
        let record: Value = serde_json::from_str(&text).ok()?;
        record["transcript"].as_str().map(str::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use isbell_proto::frame::Header;

    use super::*;

    fn guests(panes: &[&str]) -> (Guests, watch::Sender<Vec<String>>) {
        let (inbox, _rx) = mpsc::unbounded_channel();
        let (tx, rx) = watch::channel(panes.iter().map(|p| (*p).to_owned()).collect());
        (Guests::new(HerdrSlot::default(), rx, None, PathBuf::new(), Vec::new(), inbox), tx)
    }

    fn refused(guests: &mut Guests, m: &str, p: Value) -> Option<String> {
        let (out, mut replies) = mpsc::unbounded_channel();
        let call = Header::Call { id: 1, m: m.into(), p, mid: None, from: None };
        guests.handle(Link::peer("guest".into(), out), Frame::new(call));
        match replies.try_recv().ok()?.header {
            Header::Res { ok: false, e: Some(e), .. } => Some(e.code),
            _ => None,
        }
    }

    #[tokio::test]
    async fn a_guest_gets_nothing_but_the_calls_on_agents() {
        let (mut guests, _panes) = guests(&["w1:p1"]);
        for method in Method::ALL.into_iter().filter(|m| *m != Method::Herdr) {
            if OWN_METHODS.contains(&method) {
                continue;
            }
            let p = json!({"path": "/etc/passwd", "target": "w1:p1", "cwd": "/"});
            let code = refused(&mut guests, method.name(), p);
            assert_eq!(
                code.as_deref(),
                Some("method_not_allowed"),
                "{} must be refused",
                method.name()
            );
        }
        for name in
            ["agent.list", "agent.rename", "pane.close", "workspace.list", "session.snapshot"]
        {
            let p = json!({"method": name, "params": {"target": "w1:p1"}});
            assert_eq!(refused(&mut guests, "herdr", p).as_deref(), Some("method_not_allowed"));
        }
        assert!(guests.tasks.is_empty(), "nothing was started for a refused call");
    }

    #[tokio::test]
    async fn only_the_panes_shared_now_are_reached() {
        let (mut guests, panes) = guests(&["w1:p1"]);
        let prompt = |target: &str| json!({"method": "agent.prompt", "params": {"target": target, "text": "hi"}});
        let not_shared = Some("not_shared");
        // Another pane, or an agent's name rather than the pane's id.
        assert_eq!(refused(&mut guests, "herdr", prompt("w1:p2")).as_deref(), not_shared);
        assert_eq!(refused(&mut guests, "herdr", prompt("claude-x")).as_deref(), not_shared);
        let read = json!({"method": "pane.read", "params": {"pane_id": "w1:p2"}});
        assert_eq!(refused(&mut guests, "herdr", read).as_deref(), not_shared);
        let session = json!({"paneId": "w1:p2"});
        assert_eq!(refused(&mut guests, SESSION, session).as_deref(), not_shared);
        // A new shell is not an agent shared.
        let shell = json!({"new": {"cwd": "/"}, "mode": "control", "cols": 80, "rows": 24});
        assert_eq!(
            refused(&mut guests, "isbell.terminal", shell).as_deref(),
            Some("method_not_allowed")
        );

        // A file larger than a guest may send.
        let big = json!({"name": "big.bin", "size": GUEST_UPLOAD_MAX + 1});
        assert_eq!(refused(&mut guests, "isbell.file.upload", big).as_deref(), Some("too_large"));

        // Unshared while the link is held: refused from then on.
        panes.send_replace(Vec::new());
        assert_eq!(refused(&mut guests, "herdr", prompt("w1:p1")).as_deref(), not_shared);
    }

    #[test]
    fn finds_the_transcript_the_hook_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("Users-x-web-1a2b3c4d").join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let record = json!({"agent": "claude", "id": "c1", "transcript": "/x/c1.jsonl"});
        std::fs::write(sessions.join("claude-c1.json"), record.to_string()).unwrap();
        assert_eq!(recorded_transcript(dir.path(), "claude", "c1").as_deref(), Some("/x/c1.jsonl"));
        assert_eq!(recorded_transcript(dir.path(), "codex", "c1"), None);
    }
}
