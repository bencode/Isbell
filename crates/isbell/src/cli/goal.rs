//! `isbell goal …`: the user's goals on this machine (`~/.isbell/goals.json`), a tree of what and
//! why.

use clap::{Args, Subcommand};

use super::output::CliError;
use super::{Ctx, book_link, text_arg};
use crate::book::Books;
use crate::book::goals::{self, Goal, GoalChange, GoalFilter, GoalState, Goals, Shown};
use crate::now_ms;

#[derive(Subcommand)]
pub enum GoalCmd {
    /// The open goals as JSON, each followed by those under it.
    List {
        /// Ended ones too.
        #[arg(long, conflicts_with = "state")]
        all: bool,
        /// Those in this state (repeatable).
        #[arg(long, value_enum)]
        state: Vec<GoalState>,
        /// Text in the title, outcome or text, whatever its case.
        #[arg(long = "match")]
        matches: Option<String>,
    },
    /// A goal with those above it, the top one first, and its tasks.
    Show { id: u64 },
    /// Add an open goal, the last of its siblings; prints its id.
    Add {
        title: String,
        /// What counts as done, in one line.
        #[arg(long)]
        outcome: String,
        #[command(flatten)]
        fields: Fields,
    },
    /// Change a goal; `''` clears an optional field, `--parent 0` makes it a top goal.
    Update {
        id: u64,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        outcome: Option<String>,
        #[arg(long, value_enum)]
        state: Option<GoalState>,
        /// Its place among its siblings, from 1.
        #[arg(long, default_value_t = 0)]
        rank: usize,
        #[command(flatten)]
        fields: Fields,
    },
    /// Take out a goal nothing is under; drop any other instead.
    Delete { id: u64 },
}

#[derive(Args)]
pub struct Fields {
    /// The goal it serves.
    #[arg(long)]
    parent: Option<u64>,
    /// A date, as 2026-11-28.
    #[arg(long)]
    due: Option<String>,
    /// A month as 2026-11, an ISO week as 2026-W48 or a day as 2026-11-23.
    #[arg(long)]
    period: Option<String>,
    /// `file:<path>` or `project:<path>`.
    #[arg(long)]
    link: Option<String>,
    /// At most 4 KiB; `-` reads standard input. Longer goes in a file it links to.
    #[arg(long)]
    text: Option<String>,
}

pub fn run(ctx: &Ctx, cmd: GoalCmd) -> Result<(), CliError> {
    let books = Books::home()?;
    match cmd {
        GoalCmd::List { all, state, matches } => {
            let book = books.read::<Goals>()?;
            ctx.out.json(&goals::select_goals(&book, &GoalFilter { states: state, all, matches }));
        }
        GoalCmd::Show { id } => {
            let book = books.read::<Goals>()?;
            book.goal(id).ok_or_else(|| CliError::new("not_found", format!("no goal G{id}")))?;
            let tasks: Vec<_> = book.tasks.iter().filter(|t| t.goal == id).collect();
            ctx.out.json(&Shown { goals: book.chain(id), tasks });
        }
        GoalCmd::Add { title, outcome, fields } => {
            let link = fields.link.as_deref().map(book_link).transpose()?.filter(|l| !l.is_empty());
            let goal = Goal {
                id: 0,
                parent: fields.parent.filter(|p| *p != 0),
                title,
                outcome,
                text: text_arg(fields.text)?.filter(|t| !t.is_empty()),
                link,
                due: fields.due.filter(|d| !d.is_empty()),
                period: fields.period.filter(|p| !p.is_empty()),
                state: GoalState::Open,
                created_at: 0,
                ended_at: None,
            };
            let id = books.change(|_, book| goals::add_goal(book, goal, now_ms()))?;
            println!("{id}");
        }
        GoalCmd::Update { id, title, outcome, state, rank, fields } => {
            let change = GoalChange {
                title,
                outcome,
                text: text_arg(fields.text)?,
                link: fields.link.as_deref().map(book_link).transpose()?,
                due: fields.due,
                period: fields.period,
                parent: fields.parent,
                state,
                rank,
            };
            books.change(|_, book| Ok((goals::update_goal(book, id, change, now_ms())?, ())))?;
        }
        GoalCmd::Delete { id } => {
            books.change(|_, book| Ok((goals::delete_goal(book, id)?, ())))?
        }
    }
    Ok(())
}
