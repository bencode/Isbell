//! `isbell message …`: what agents tell the user, kept on this machine (`~/.isbell/messages.json`).

use clap::Subcommand;

use super::output::CliError;
use super::{Ctx, book_link, text_arg};
use crate::book::caller::{self, Caller};
use crate::book::goals::Goals;
use crate::book::messages::{self, Draft, From, Kind, Messages, Reply, Update};
use crate::book::roles::Roles;
use crate::book::{BookError, Books};
use crate::now_ms;

#[derive(Subcommand)]
pub enum MessageCmd {
    /// Tell the user something; prints the message's id. One message a matter: follow it up with
    /// `update`.
    Send {
        /// What happened, in one line.
        #[arg(long)]
        title: Option<String>,
        #[arg(long, value_enum, default_value_t = Kind::Info)]
        kind: Kind,
        /// What it is about: `session` (the default in an agent, the caller's own),
        /// `file:<path>`, `project:<path>`, or `none`.
        #[arg(long)]
        link: Option<String>,
        /// The task it is about.
        #[arg(long)]
        task: Option<u64>,
        /// What the user needs beyond the title; `-` reads standard input.
        text: Option<String>,
    },
    /// Change a message's kind or task, or add the text as a reply, or any of them.
    Update {
        id: u64,
        #[arg(long, value_enum)]
        kind: Option<Kind>,
        #[arg(long)]
        task: Option<u64>,
        /// The reply; `-` reads standard input.
        text: Option<String>,
    },
    /// The messages as JSON, the latest active first.
    List,
}

pub fn run(ctx: &Ctx, cmd: MessageCmd) -> Result<(), CliError> {
    let books = Books::home()?;
    let caller = caller::this();
    match cmd {
        MessageCmd::Send { title, kind, link, task, text } => {
            let link = link_of(link.as_deref(), caller.as_ref())?;
            let text = text_arg(text)?;
            let id = books.change(|books, book: Messages| {
                check_task(books, task)?;
                let roles = books.read::<Roles>()?;
                let from = caller.as_ref().map(|c| from_of(c, &roles));
                let draft = Draft { kind, title, text, link, task, from };
                messages::send(book, draft, now_ms())
            })?;
            println!("{id}");
            Ok(())
        }
        MessageCmd::Update { id, kind, task, text } => {
            let text = text_arg(text)?;
            books.change(|books, book: Messages| {
                check_task(books, task)?;
                let roles = books.read::<Roles>()?;
                let role = caller.as_ref().and_then(|c| role_name(c, &roles));
                let reply = text.map(|text| Reply { time: now_ms(), text, role });
                Ok((messages::update(book, id, Update { kind, task, reply })?, ()))
            })?;
            Ok(())
        }
        MessageCmd::List => {
            ctx.out.json(&books.read::<Messages>()?.messages);
            Ok(())
        }
    }
}

/// The link as a message keeps it: by default the caller's own session, none outside an agent.
fn link_of(link: Option<&str>, caller: Option<&Caller>) -> Result<Option<String>, CliError> {
    let session = || caller.map(|c| format!("session:{}:{}", c.agent.as_str(), c.session));
    match link {
        None => Ok(session()),
        Some("none") => Ok(None),
        Some("session") => session().map(Some).ok_or_else(|| {
            CliError::new(
                "invalid",
                "--link session links the caller's session: run it in an agent",
            )
        }),
        Some(link) => book_link(link).map(Some),
    }
}

fn check_task(books: &Books, task: Option<u64>) -> Result<(), BookError> {
    match task {
        Some(id) if books.read::<Goals>()?.task(id).is_none() => {
            Err(BookError::not_found(format!("no task T{id}")))
        }
        _ => Ok(()),
    }
}

fn role_name(caller: &Caller, roles: &Roles) -> Option<String> {
    roles.of(caller.agent, &caller.session).map(|r| r.name.clone())
}

fn from_of(caller: &Caller, roles: &Roles) -> From {
    From {
        agent: caller.agent,
        session: caller.session.clone(),
        pane: caller.pane.clone(),
        role: role_name(caller, roles),
        dir: caller.dir.to_string_lossy().into_owned(),
    }
}
