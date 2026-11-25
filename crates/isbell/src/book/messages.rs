//! What agents tell the user: one message a matter, followed up with replies, its kind telling
//! whether it still asks for them. The latest active come first: a reply brings its message to the
//! top.

use serde::{Deserialize, Serialize};

use super::caller::Agent;
use super::{Book, BookError, Version, check_link, is_line};

pub const KEPT: usize = 500;
pub const REPLIES_KEPT: usize = 50;
pub const MAX_TITLE: usize = 200;
pub const MAX_TEXT: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// The user has something to do.
    Ask,
    Warn,
    Done,
    Info,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Messages {
    pub version: Version,
    /// The last id given; ids never come back.
    pub last: u64,
    pub messages: Vec<Message>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Message {
    pub id: u64,
    /// Milliseconds since the epoch.
    pub time: u64,
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<From>,
    /// The oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub replies: Vec<Reply>,
}

/// The agent session that sent a message.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct From {
    pub agent: Agent,
    pub session: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub dir: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub time: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// A message to send: all of it but its id.
pub struct Draft {
    pub kind: Kind,
    pub title: Option<String>,
    pub text: Option<String>,
    pub link: Option<String>,
    pub task: Option<u64>,
    pub from: Option<From>,
}

/// What an update changes: its kind, its task, a reply, at least one of them.
#[derive(Default)]
pub struct Update {
    pub kind: Option<Kind>,
    pub task: Option<u64>,
    pub reply: Option<Reply>,
}

impl Book for Messages {
    const FILE: &'static str = "messages.json";

    fn check(&self) -> Result<(), BookError> {
        if self.messages.len() > KEPT {
            return Err(BookError::invalid(format!("more than {KEPT} messages")));
        }
        let mut ids = std::collections::HashSet::new();
        self.messages.iter().try_for_each(|m| {
            if m.id < 1 || m.id > self.last || !ids.insert(m.id) {
                return Err(BookError::invalid(format!(
                    "message {}: id is not its own, from 1 to the last given, {}",
                    m.id, self.last
                )));
            }
            check_message(m)
                .map_err(|err| BookError::invalid(format!("message M{}: {}", m.id, err.message)))
        })
    }
}

fn check_message(m: &Message) -> Result<(), BookError> {
    if m.title.is_none() && m.text.is_none() {
        return Err(BookError::invalid("a message has a title, a text or both"));
    }
    if m.title.as_deref().is_some_and(|t| !is_line(t, MAX_TITLE)) {
        return Err(BookError::invalid(format!(
            "the title must be one line of 1 to {MAX_TITLE} bytes"
        )));
    }
    if m.text.as_deref().is_some_and(|t| !is_text(t)) {
        return Err(BookError::invalid(format!("the text must have 1 to {MAX_TEXT} bytes")));
    }
    if let Some(link) = &m.link {
        check_link(link, true)?;
    }
    if m.replies.len() > REPLIES_KEPT || m.replies.iter().any(|r| !is_text(&r.text)) {
        return Err(BookError::invalid(format!(
            "at most {REPLIES_KEPT} replies, each of 1 to {MAX_TEXT} bytes"
        )));
    }
    Ok(())
}

fn is_text(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= MAX_TEXT
}

/// The book with the message sent, on top, and its id. The least active beyond those kept go.
pub fn send(book: Messages, draft: Draft, now: u64) -> Result<(Messages, u64), BookError> {
    let id = book.last + 1;
    let message = Message {
        id,
        time: now,
        kind: draft.kind,
        title: draft.title,
        text: draft.text,
        link: draft.link,
        task: draft.task,
        from: draft.from,
        replies: Vec::new(),
    };
    check_message(&message)?;
    let messages = std::iter::once(message).chain(book.messages).take(KEPT).collect();
    Ok((Messages { version: book.version, last: id, messages }, id))
}

/// The book with the message changed. A reply brings it to the top; the oldest replies beyond
/// those kept go. A new kind or task alone leaves it where it is.
pub fn update(book: Messages, id: u64, change: Update) -> Result<Messages, BookError> {
    if change.kind.is_none() && change.task.is_none() && change.reply.is_none() {
        return Err(BookError::invalid("give a kind, a task or a text to reply with"));
    }
    let i = book
        .messages
        .iter()
        .position(|m| m.id == id)
        .ok_or_else(|| BookError::not_found(format!("no message M{id}")))?;
    let mut messages = book.messages;
    let mut m = messages.remove(i);
    m.kind = change.kind.unwrap_or(m.kind);
    m.task = change.task.or(m.task);
    let at = match change.reply {
        Some(reply) => {
            m.replies.push(reply);
            let over = m.replies.len().saturating_sub(REPLIES_KEPT);
            m.replies.drain(..over);
            0
        }
        None => i,
    };
    check_message(&m)?;
    messages.insert(at, m);
    Ok(Messages { messages, ..book })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(title: &str) -> Draft {
        Draft {
            kind: Kind::Info,
            title: Some(title.into()),
            text: None,
            link: None,
            task: None,
            from: None,
        }
    }

    fn reply(text: &str) -> Update {
        Update {
            reply: Some(Reply { time: 9, text: text.into(), role: None }),
            ..Update::default()
        }
    }

    fn get(book: &Messages, id: u64) -> &Message {
        book.messages.iter().find(|m| m.id == id).unwrap()
    }

    fn ids(book: &Messages) -> Vec<u64> {
        book.messages.iter().map(|m| m.id).collect()
    }

    #[test]
    fn ids_never_come_back_once_messages_go() {
        let book = (0..KEPT + 2)
            .fold(Messages::default(), |b, n| send(b, draft(&n.to_string()), 1).unwrap().0);
        assert_eq!(book.messages.len(), KEPT);
        assert_eq!(book.messages[0].id, KEPT as u64 + 2);
        assert_eq!(book.messages.last().unwrap().id, 3);
        assert!(book.check().is_ok());
    }

    #[test]
    fn a_reply_brings_its_message_to_the_top_and_a_kind_alone_does_not() {
        let book =
            (1..=3).fold(Messages::default(), |b, n| send(b, draft(&n.to_string()), 1).unwrap().0);
        assert_eq!(ids(&book), [3, 2, 1]);
        let book = update(book, 1, Update { kind: Some(Kind::Done), ..Update::default() }).unwrap();
        assert_eq!(ids(&book), [3, 2, 1]);
        assert_eq!(get(&book, 1).kind, Kind::Done);
        let book = update(book, 1, reply("PR #53 is open")).unwrap();
        assert_eq!(ids(&book), [1, 3, 2]);
    }

    #[test]
    fn a_message_keeps_its_latest_replies() {
        let book = send(Messages::default(), draft("t"), 1).unwrap().0;
        let book =
            (0..REPLIES_KEPT + 1).fold(book, |b, n| update(b, 1, reply(&n.to_string())).unwrap());
        let replies = &get(&book, 1).replies;
        assert_eq!(replies.len(), REPLIES_KEPT);
        assert_eq!(replies[0].text, "1");
    }

    #[test]
    fn what_does_not_hold_is_refused() {
        let empty = Draft { title: None, ..draft("") };
        assert!(send(Messages::default(), empty, 1).is_err());
        assert!(send(Messages::default(), draft("two\nlines"), 1).is_err());
        let book = send(Messages::default(), draft("t"), 1).unwrap().0;
        assert_eq!(update(book, 1, Update::default()).unwrap_err().code, "invalid");
        let unknown =
            r#"{"version":1,"last":1,"messages":[{"id":1,"time":1,"kind":"urgent","title":"t"}]}"#;
        assert!(serde_json::from_str::<Messages>(unknown).is_err());
    }
}
