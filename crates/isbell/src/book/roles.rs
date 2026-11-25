//! What agents are called across sessions: a name is a role, and the sessions that took it are its
//! memory. A role may report to another, its lead. As Jun's roles, without `open`: whether a role
//! runs is told by its live sessions.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::caller::{Agent, Caller};
use super::{Book, BookError, Version, is_line};

pub const MAX_NAME: usize = 64;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Roles {
    pub version: Version,
    pub roles: Vec<Role>,
    /// Each in the order it took its role.
    pub sessions: Vec<Session>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Role {
    pub id: u64,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub role: u64,
    pub agent: Agent,
    pub id: String,
    /// The agent's directory, when not its default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    /// Pi's session file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub dir: String,
    /// When it took the role, in milliseconds since the epoch.
    pub at: u64,
}

/// An agent session running now, as herdr reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Live {
    pub agent: Agent,
    pub session: String,
    pub pane: String,
    /// Its herdr name, the one agent-talk addresses it by.
    pub name: Option<String>,
}

/// What tells names apart: their case does not.
fn key(name: &str) -> String {
    name.to_lowercase()
}

impl Roles {
    pub fn named(&self, name: &str) -> Option<&Role> {
        self.roles.iter().find(|r| key(&r.name) == key(name))
    }

    pub fn role(&self, id: u64) -> Option<&Role> {
        self.roles.iter().find(|r| r.id == id)
    }

    /// The role whose memory has the session.
    pub fn of(&self, agent: Agent, id: &str) -> Option<&Role> {
        let s = self.sessions.iter().find(|s| s.agent == agent && s.id == id)?;
        self.role(s.role)
    }

    /// The role's sessions, the latest first.
    pub fn memory(&self, role: u64) -> Vec<&Session> {
        self.sessions.iter().rev().filter(|s| s.role == role).collect()
    }

    /// The roles reporting to `lead`, directly or through others, each after the one it reports to.
    pub fn team(&self, lead: u64) -> Vec<&Role> {
        let direct = self.roles.iter().filter(|r| r.lead == Some(lead));
        direct.flat_map(|r| std::iter::once(r).chain(self.team(r.id))).collect()
    }

    /// Whether `role` reports to `lead`, directly or through others; a role is its own here.
    fn reports_to(&self, role: u64, lead: u64) -> bool {
        let mut chain = std::iter::successors(Some(role), |r| self.role(*r)?.lead);
        chain.by_ref().take(self.roles.len() + 1).any(|r| r == lead)
    }
}

/// The session of the caller, as a role keeps it.
pub fn session_of(caller: &Caller, now: u64) -> Session {
    let path = |p: &std::path::PathBuf| p.to_string_lossy().into_owned();
    Session {
        role: 0,
        agent: caller.agent,
        id: caller.session.clone(),
        home: caller.home.as_ref().map(path),
        path: caller.path.as_ref().map(path),
        dir: path(&caller.dir),
        at: now,
    }
}

/// The book with the session given to the role of the name: a new role if there is none, else
/// that role taken on, its memory the session's, unless another of its sessions runs now. The
/// session leaves the role it was in; a role it was alone in is renamed instead.
pub fn take(book: Roles, name: &str, session: Session, live: &[Live]) -> Result<Roles, BookError> {
    if !is_line(name, MAX_NAME) || name.trim() != name || name.chars().all(|c| c.is_ascii_digit()) {
        return Err(BookError::invalid(format!(
            "a name is one line of 1 to {MAX_NAME} bytes, not a number, with no space around it"
        )));
    }
    let existing = book.named(name).cloned();
    if let Some(role) = &existing {
        if book.of(session.agent, &session.id).is_some_and(|mine| mine.id == role.id) {
            return Ok(book);
        }
        let running = live
            .iter()
            .find(|l| book.memory(role.id).iter().any(|s| s.agent == l.agent && s.id == l.session));
        if let Some(l) = running {
            return Err(BookError::invalid(format!(
                "{} is taken by the agent in pane {}",
                role.name, l.pane
            )));
        }
    }
    // A role's only session taking a name no role has renames the role: it keeps its lead.
    let sole =
        book.of(session.agent, &session.id).map(|r| r.id).filter(|r| book.memory(*r).len() == 1);
    if let (None, Some(id)) = (&existing, sole) {
        let mut book = book;
        book.roles.iter_mut().filter(|r| r.id == id).for_each(|r| r.name = name.to_owned());
        return Ok(book);
    }
    let mut book = leave(book, session.agent, &session.id);
    let role = existing.unwrap_or_else(|| {
        let id = book.roles.iter().map(|r| r.id).max().unwrap_or(0) + 1;
        let role = Role { id, name: name.to_owned(), lead: None };
        book.roles.push(role.clone());
        role
    });
    book.sessions.push(Session { role: role.id, ..session });
    Ok(book)
}

/// The book with the session out of its role. A role left with none goes, and every lead it was.
pub fn leave(mut book: Roles, agent: Agent, id: &str) -> Roles {
    let Some(role) = book.of(agent, id).map(|r| r.id) else {
        return book;
    };
    book.sessions.retain(|s| s.agent != agent || s.id != id);
    if book.memory(role).is_empty() {
        book.roles.retain(|r| r.id != role);
        book.roles.iter_mut().filter(|r| r.lead == Some(role)).for_each(|r| r.lead = None);
    }
    book
}

/// The book with the role reporting to `lead`, or to none. The latest lead wins: a role that led
/// this one, itself or through others, stops reporting to it.
pub fn set_lead(mut book: Roles, role: u64, lead: Option<&str>) -> Result<Roles, BookError> {
    let lead = match lead {
        None => None,
        Some(name) => {
            let l =
                book.named(name).ok_or_else(|| BookError::not_found(format!("no role {name}")))?;
            if l.id == role {
                return Err(BookError::invalid("a role cannot lead itself"));
            }
            Some(l.id)
        }
    };
    // The one in the lead's chain that reports to this role: its report would close a loop.
    let looped = lead.and_then(|lead| {
        std::iter::successors(Some(lead), |r| book.role(*r)?.lead)
            .take(book.roles.len())
            .find(|r| book.role(*r).and_then(|x| x.lead) == Some(role))
    });
    for r in &mut book.roles {
        if r.id == role {
            r.lead = lead;
        } else if Some(r.id) == looped {
            r.lead = None;
        }
    }
    Ok(book)
}

impl Book for Roles {
    const FILE: &'static str = "roles.json";

    fn check(&self) -> Result<(), BookError> {
        let (mut ids, mut names) = (HashSet::new(), HashSet::new());
        for r in &self.roles {
            if r.id < 1 || !ids.insert(r.id) {
                return Err(BookError::invalid(format!(
                    "role {:?}: id {} is not its own",
                    r.name, r.id
                )));
            }
            if !is_line(&r.name, MAX_NAME) || !names.insert(key(&r.name)) {
                return Err(BookError::invalid(format!(
                    "role {}: name {:?} is not its own",
                    r.id, r.name
                )));
            }
        }
        let mut seen = HashSet::new();
        for s in &self.sessions {
            if s.id.is_empty() || !seen.insert((s.agent, s.id.as_str())) || !ids.contains(&s.role) {
                return Err(BookError::invalid(format!(
                    "{} session {:?} is not one of its own, in a role that is there",
                    s.agent.as_str(),
                    s.id
                )));
            }
        }
        for r in &self.roles {
            if !self.sessions.iter().any(|s| s.role == r.id) {
                return Err(BookError::invalid(format!("role {} has no session", r.name)));
            }
            if let Some(lead) = r.lead
                && (!ids.contains(&lead) || self.reports_to(lead, r.id))
            {
                return Err(BookError::invalid(format!(
                    "role {}: lead {lead} is no role it can report to",
                    r.name
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str) -> Session {
        Session {
            role: 0,
            agent: Agent::Claude,
            id: id.into(),
            home: None,
            path: None,
            dir: "/w".into(),
            at: 1,
        }
    }

    fn named(names: &[(&str, &str)]) -> Roles {
        names
            .iter()
            .fold(Roles::default(), |b, (name, id)| take(b, name, session(id), &[]).unwrap())
    }

    fn lead_of<'a>(book: &'a Roles, name: &str) -> Option<&'a str> {
        let lead = book.named(name)?.lead?;
        book.role(lead).map(|r| r.name.as_str())
    }

    fn live(id: &str) -> Live {
        Live { agent: Agent::Claude, session: id.into(), pane: "w1:p1".into(), name: None }
    }

    #[test]
    fn a_renamed_session_moves_and_a_role_left_with_none_goes() {
        let names = |b: &Roles| b.roles.iter().map(|r| r.name.clone()).collect::<Vec<_>>();
        let book = named(&[("Euler", "s1"), ("Euler", "s2"), ("Gauss", "s1")]);
        assert_eq!(names(&book), ["Euler", "Gauss"]);
        assert_eq!(book.of(Agent::Claude, "s1").unwrap().name, "Gauss");
        let book = take(book, "Euler", session("s1"), &[]).unwrap();
        assert_eq!(names(&book), ["Euler"], "Gauss lost its only session");
        assert!(book.check().is_ok());
        let book = leave(leave(book, Agent::Claude, "s1"), Agent::Claude, "s2");
        assert!(book.roles.is_empty() && book.sessions.is_empty());
    }

    #[test]
    fn a_role_is_taken_on_only_while_none_of_its_sessions_runs() {
        let book = named(&[("Euler", "s1")]);
        let err = take(book, "euler", session("s2"), &[live("s1")]).unwrap_err();
        assert!(err.message.contains("w1:p1"), "{}", err.message);
        let book = named(&[("Euler", "s1")]);
        let book = take(book, "euler", session("s2"), &[live("s9")]).unwrap();
        let euler = book.named("Euler").unwrap().id;
        assert_eq!(
            book.memory(euler).iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["s2", "s1"]
        );
    }

    #[test]
    fn names_that_do_not_hold_are_refused() {
        ["", "42", " Euler", "two\nlines", &"x".repeat(MAX_NAME + 1)].iter().for_each(|name| {
            assert!(take(Roles::default(), name, session("s1"), &[]).is_err(), "{name:?}")
        });
        assert!(take(Roles::default(), "麦克斯韦", session("s1"), &[]).is_ok());
    }

    #[test]
    fn the_latest_lead_wins() {
        let book = named(&[("A", "a"), ("B", "b"), ("C", "c")]);
        let id = |b: &Roles, n: &str| b.named(n).unwrap().id;
        let book = set_lead(book, 2, Some("A")).unwrap(); // B → A
        let book = set_lead(book, 3, Some("B")).unwrap(); // C → B → A
        assert_eq!(book.team(1).iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["B", "C"]);
        let a = id(&book, "A");
        let book = set_lead(book, a, Some("C")).unwrap(); // A → C, so B stops reporting to A
        assert_eq!(
            (lead_of(&book, "A"), lead_of(&book, "B"), lead_of(&book, "C")),
            (Some("C"), None, Some("B"))
        );
        assert!(book.check().is_ok());
        assert!(set_lead(book, a, Some("A")).is_err());
    }

    #[test]
    fn renaming_a_role_alone_in_its_session_keeps_its_lead() {
        let book = set_lead(named(&[("A", "a"), ("B", "b")]), 2, Some("A")).unwrap();
        let book = take(book, "B2", session("b"), &[]).unwrap();
        assert_eq!(lead_of(&book, "B2"), Some("A"));
        assert!(book.named("B").is_none());
    }

    #[test]
    fn a_lead_that_goes_leaves_its_reports_with_none() {
        let book = set_lead(named(&[("A", "a"), ("B", "b")]), 2, Some("A")).unwrap();
        let book = leave(book, Agent::Claude, "a");
        assert_eq!(book.named("B").unwrap().lead, None);
    }
}
