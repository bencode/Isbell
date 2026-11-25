//! `isbell role …`: agents' names on this machine (`~/.isbell/roles.json`). A name is a role; the
//! sessions that took it are its memory.

use clap::Subcommand;
use serde::Serialize;

use super::Ctx;
use super::output::CliError;
use crate::book::caller::{self, Agent, Caller};
use crate::book::roles::{self, Live, Role, Roles, Session};
use crate::book::{BookError, Books, live};
use crate::now_ms;

#[derive(Subcommand)]
pub enum RoleCmd {
    /// Name your own session: the name is a role, and your session becomes part of its memory.
    Name {
        #[arg(required_unless_present = "clear")]
        name: Option<String>,
        /// Take your session out of its role.
        #[arg(long, conflicts_with = "name")]
        clear: bool,
    },
    /// The role of your session, with its latest sessions; `[]` for none.
    Mine {
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// The roles as JSON.
    List,
    /// A role with its latest sessions.
    Show {
        name: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// A role, then the roles reporting to it, directly or through others.
    Team { name: String },
    /// Make the role of that name your role's lead.
    Join { name: String },
    /// Drop your role's lead.
    Leave,
}

/// A role as the commands give it.
#[derive(Serialize)]
struct RoleView<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    lead: Option<&'a str>,
    count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    last: Option<SessionView<'a>>,
    /// Where it runs now, if it does.
    #[serde(skip_serializing_if = "Option::is_none")]
    live: Option<LiveView<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sessions: Option<Vec<SessionView<'a>>>,
}

#[derive(Serialize)]
struct SessionView<'a> {
    agent: Agent,
    id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    home: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
    dir: &'a str,
    at: u64,
}

#[derive(Serialize)]
struct LiveView<'a> {
    pane: &'a str,
    /// Its herdr name, for agent-talk.
    #[serde(skip_serializing_if = "Option::is_none")]
    herdr: Option<&'a str>,
}

pub async fn run(ctx: &Ctx, cmd: RoleCmd) -> Result<(), CliError> {
    let books = Books::home()?;
    match cmd {
        RoleCmd::Name { name: Some(name), .. } => {
            let caller = in_agent()?;
            let live = live::sessions().await;
            let session = roles::session_of(&caller, now_ms());
            books.change(|_, book: Roles| Ok((roles::take(book, &name, session, &live)?, ())))?;
        }
        RoleCmd::Name { name: None, .. } => {
            let caller = in_agent()?;
            books.change(|_, book: Roles| {
                Ok((roles::leave(book, caller.agent, &caller.session), ()))
            })?;
        }
        RoleCmd::Join { name } => set_lead(&books, Some(&name))?,
        RoleCmd::Leave => set_lead(&books, None)?,
        RoleCmd::Mine { limit } => {
            let caller = in_agent()?;
            let (book, live) = (books.read::<Roles>()?, live::sessions().await);
            let mine = book.of(caller.agent, &caller.session);
            let views: Vec<_> =
                mine.map(|r| view(&book, r, &live, Some(limit))).into_iter().collect();
            ctx.out.json(&views);
        }
        RoleCmd::List => {
            let (book, live) = (books.read::<Roles>()?, live::sessions().await);
            let views: Vec<_> = book.roles.iter().map(|r| view(&book, r, &live, None)).collect();
            ctx.out.json(&views);
        }
        RoleCmd::Show { name, limit } => {
            let (book, live) = (books.read::<Roles>()?, live::sessions().await);
            let role = named(&book, &name)?;
            ctx.out.json(&view(&book, role, &live, Some(limit)));
        }
        RoleCmd::Team { name } => {
            let (book, live) = (books.read::<Roles>()?, live::sessions().await);
            let lead = named(&book, &name)?;
            let team = std::iter::once(lead).chain(book.team(lead.id));
            let views: Vec<_> = team.map(|r| view(&book, r, &live, None)).collect();
            ctx.out.json(&views);
        }
    }
    Ok(())
}

fn in_agent() -> Result<Caller, CliError> {
    caller::this().ok_or_else(|| {
        CliError::new(
            "not_an_agent",
            "no agent session: run this from Claude Code, Codex or pi, which give their commands \
             CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID or PI_SESSION_ID",
        )
    })
}

fn set_lead(books: &Books, lead: Option<&str>) -> Result<(), CliError> {
    let caller = in_agent()?;
    books.change(|_, book: Roles| {
        let mine = book.of(caller.agent, &caller.session).map(|r| r.id).ok_or_else(|| {
            BookError::not_found(
                "your session has no role: name yourself first (`isbell role name <name>`)",
            )
        })?;
        Ok((roles::set_lead(book, mine, lead)?, ()))
    })?;
    Ok(())
}

fn named<'a>(book: &'a Roles, name: &str) -> Result<&'a Role, CliError> {
    book.named(name).ok_or_else(|| CliError::new("not_found", format!("no role {name}")))
}

/// The role as the commands give it; with its `limit` latest sessions when asked.
fn view<'a>(
    book: &'a Roles,
    role: &'a Role,
    live: &'a [Live],
    limit: Option<usize>,
) -> RoleView<'a> {
    let memory = book.memory(role.id);
    let running =
        live.iter().find(|l| memory.iter().any(|s| s.agent == l.agent && s.id == l.session));
    RoleView {
        name: &role.name,
        lead: role.lead.and_then(|l| book.role(l)).map(|l| l.name.as_str()),
        count: memory.len(),
        last: memory.first().map(|s| session_view(s)),
        live: running.map(|l| LiveView { pane: &l.pane, herdr: l.name.as_deref() }),
        sessions: limit.map(|n| memory.iter().take(n).map(|s| session_view(s)).collect()),
    }
}

fn session_view(s: &Session) -> SessionView<'_> {
    SessionView {
        agent: s.agent,
        id: &s.id,
        home: s.home.as_deref(),
        path: s.path.as_deref(),
        dir: &s.dir,
        at: s.at,
    }
}
