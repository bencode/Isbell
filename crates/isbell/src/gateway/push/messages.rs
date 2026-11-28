//! Pushes the messages agents send the user that ask them something or warn them, as they come into
//! this machine's messages book. A tap opens the session that sent one, the message pinned over its
//! chat, while it runs; the inbox once it ended.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use isbell_proto::state::MachineState;
use tokio::sync::watch;

use super::{Notice, Push, Title, session_url};
use crate::book::messages::{Kind, Message, Messages};
use crate::book::{Book, Books};
use crate::gateway::workspace;

const TICK: Duration = Duration::from_secs(3);
/// A push carries 4 KiB at most, sealed: a text is cut well short of it.
const MAX_TITLE_CHARS: usize = 180;

/// Watches the messages book and pushes what is due. The book as first read is only where it
/// starts from: what was sent before the gateway started is not news.
pub async fn run(push: Arc<Push>, states: watch::Receiver<Option<MachineState>>) {
    let Some(dir) = workspace::expand_home("~/.isbell") else {
        tracing::warn!("HOME is not set, so no message is pushed");
        return;
    };
    let file = dir.join(Messages::FILE);
    let books = Arc::new(Books::at(dir));
    let mut last: Option<u64> = None;
    let mut changed: Option<SystemTime> = None;
    let mut tick = tokio::time::interval(TICK);
    loop {
        tick.tick().await;
        // Not there yet, the book is empty: its first message is news.
        let mtime = tokio::fs::metadata(&file).await.and_then(|m| m.modified()).ok();
        if last.is_some() && mtime == changed {
            continue;
        }
        let Some(state) = states.borrow().clone() else { continue };
        // Written whole by a rename, a book read is never half one: one that cannot be read is read
        // again once it changes.
        changed = mtime;
        let reading = Arc::clone(&books);
        let book = match tokio::task::spawn_blocking(move || reading.read::<Messages>()).await {
            Ok(Ok(book)) => book,
            Ok(Err(err)) => {
                tracing::warn!(err = %err.message, "cannot read the messages to push");
                continue;
            }
            Err(err) => {
                tracing::error!(%err, "reading the messages to push failed");
                continue;
            }
        };
        if let Some(last) = last {
            for m in due(last, &book) {
                tokio::spawn(Arc::clone(&push).send(notice(m, &state)));
            }
        }
        last = Some(book.last);
    }
}

/// The messages sent since the last id given was `last` that ask the user something or warn them.
/// Ids only grow, so a new one is one above it.
fn due(last: u64, now: &Messages) -> Vec<&Message> {
    now.messages
        .iter()
        .filter(|m| m.id > last && matches!(m.kind, Kind::Ask | Kind::Warn))
        .collect()
}

/// The push for `m`, on the machine `state` describes.
fn notice(m: &Message, state: &MachineState) -> Notice {
    let mid = &state.machine.id;
    let said =
        m.title.as_deref().or(m.text.as_deref().and_then(|t| t.lines().next())).unwrap_or("");
    let title = if said.chars().count() > MAX_TITLE_CHARS {
        format!("{}…", said.chars().take(MAX_TITLE_CHARS).collect::<String>())
    } else {
        said.to_owned()
    };
    let from = m.from.as_ref();
    let who = from.map(|f| f.role.clone().unwrap_or_else(|| f.agent.as_str().to_owned()));
    let running = from
        .and_then(|f| f.pane.as_deref())
        .filter(|pane| state.agents.iter().any(|a| a.pane_id == *pane));
    Notice {
        title: Title::Said(title),
        body: who.into_iter().chain([state.machine.name.clone()]).collect::<Vec<_>>().join(" · "),
        tag: format!("{mid}/m{}", m.id),
        url: running.map_or_else(
            || "/inbox".to_owned(),
            |pane| format!("{}?m={}", session_url(mid, pane), m.id),
        ),
    }
}

#[cfg(test)]
mod tests {
    use isbell_proto::state::AgentStatus;

    use super::super::tests::{agent, state};
    use super::*;
    use crate::book::caller::Agent;
    use crate::book::messages::From as Sender;

    fn message(id: u64, kind: Kind, title: &str, pane: Option<&str>) -> Message {
        Message {
            id,
            time: 0,
            kind,
            title: Some(title.into()),
            text: None,
            link: None,
            task: None,
            from: Some(Sender {
                agent: Agent::Claude,
                session: "s".into(),
                pane: pane.map(Into::into),
                role: Some("达芬奇".into()),
                dir: "/Users/me/work/goat".into(),
            }),
            replies: vec![],
        }
    }

    #[test]
    fn a_message_is_pushed_as_it_comes_to_ask_or_warn() {
        let book = Messages {
            last: 6,
            messages: vec![
                message(6, Kind::Warn, "Nightly run failed", None),
                message(5, Kind::Info, "Released", None),
                message(4, Kind::Done, "Notes ready", None),
                message(3, Kind::Ask, "Open a PR?", Some("w1:p1")),
                message(2, Kind::Ask, "Asked before", Some("w1:p1")),
            ],
            ..Messages::default()
        };
        let ids: Vec<_> = due(2, &book).iter().map(|m| m.id).collect();
        assert_eq!(ids, [6, 3], "new asks and warnings, not other kinds nor those already there");

        let now = state(vec![agent("w1:p1", AgentStatus::Done)]);
        let pinned = notice(&book.messages[3], &now);
        assert_eq!(
            pinned,
            Notice {
                title: Title::Said("Open a PR?".into()),
                body: "达芬奇 · Mac-mini".into(),
                tag: "e339299e0679d6bb/m3".into(),
                url: "/s/e339299e0679d6bb/w1%3Ap1?m=3".into(),
            }
        );
        let gone = notice(&book.messages[3], &state(vec![]));
        assert_eq!(gone.url, "/inbox", "its session ended");

        let long = message(7, Kind::Ask, &"长".repeat(MAX_TITLE_CHARS + 1), None);
        let Title::Said(title) = notice(&long, &now).title else { panic!("a message's own words") };
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS + 1);
        assert!(title.ends_with('…'));
    }
}
