//! `isbell task …`: the tasks of the user's goals on this machine (`~/.isbell/goals.json`), each
//! followed by one role. An agent that adds or changes one is recorded in its `sessions`.

use clap::{Args, Subcommand};

use super::output::CliError;
use super::{Ctx, book_link, project_root, text_arg};
use crate::book::caller::{self, Caller};
use crate::book::goals::{
    self, Goals, Priority, Shown, Task, TaskChange, TaskFilter, TaskSession, TaskState,
};
use crate::book::roles::{self, Roles};
use crate::book::{BookError, Books};
use crate::now_ms;

#[derive(Subcommand)]
pub enum TaskCmd {
    /// The tasks not ended as JSON, by their goals; without their text and sessions.
    List {
        /// Ended ones too.
        #[arg(long, conflicts_with = "state")]
        all: bool,
        /// Those in this state (repeatable).
        #[arg(long, value_enum)]
        state: Vec<TaskState>,
        /// The role that follows them, whatever its case.
        #[arg(long)]
        owner: Option<String>,
        /// Those of the project this directory is in.
        #[arg(long)]
        project: Option<String>,
        /// That goal's, and those of the goals under it.
        #[arg(long)]
        goal: Option<u64>,
        /// Text in the title, outcome or text, whatever its case.
        #[arg(long = "match")]
        matches: Option<String>,
    },
    /// A task, whole, with its goal and those above it, the top one first.
    Show { id: u64 },
    /// Add a task to do to a goal, the last of its; prints its id.
    Add {
        title: String,
        #[arg(long)]
        goal: u64,
        #[command(flatten)]
        fields: Fields,
    },
    /// Change a task; `''` clears an optional field.
    Update {
        id: u64,
        #[arg(long)]
        title: Option<String>,
        /// Move it to another goal, the last of its unless `--rank` places it.
        #[arg(long)]
        goal: Option<u64>,
        #[arg(long, value_enum)]
        state: Option<TaskState>,
        /// Its place among its goal's tasks, from 1.
        #[arg(long, default_value_t = 0)]
        rank: usize,
        #[command(flatten)]
        fields: Fields,
    },
    /// Take out a task still to do; drop any other instead.
    Delete { id: u64 },
}

#[derive(Args)]
pub struct Fields {
    /// What counts as done, in one line.
    #[arg(long)]
    outcome: Option<String>,
    /// The role that follows it.
    #[arg(long)]
    owner: Option<String>,
    /// The project it is of, as a directory in it; by default the caller's.
    #[arg(long)]
    project: Option<String>,
    /// P0 urgent, P1 important, P2 as the rest.
    #[arg(long, value_parser = level)]
    priority: Option<Level>,
    /// `file:<path>` or `project:<path>`.
    #[arg(long)]
    link: Option<String>,
    /// At most 4 KiB; `-` reads standard input. Longer goes in a file it links to.
    #[arg(long)]
    text: Option<String>,
}

/// A priority as given: P2 is none.
#[derive(Clone)]
struct Level(Option<Priority>);

fn level(s: &str) -> Result<Level, String> {
    match s.to_ascii_uppercase().as_str() {
        "P0" => Ok(Level(Some(Priority::P0))),
        "P1" => Ok(Level(Some(Priority::P1))),
        "P2" => Ok(Level(None)),
        _ => Err("one of P0, P1 or P2".into()),
    }
}

pub fn run(ctx: &Ctx, cmd: TaskCmd) -> Result<(), CliError> {
    let books = Books::home()?;
    let caller = caller::this();
    match cmd {
        TaskCmd::List { all, state, owner, project, goal, matches } => {
            let book = books.read::<Goals>()?;
            let project = project.as_deref().map(project_root).transpose()?;
            let filter = TaskFilter { states: state, all, owner, project, goal, matches };
            let tasks: Vec<_> = goals::select_tasks(&book, &filter)
                .into_iter()
                .map(|t| Task { text: None, sessions: Vec::new(), ..t.clone() })
                .collect();
            ctx.out.json(&tasks);
        }
        TaskCmd::Show { id } => {
            let book = books.read::<Goals>()?;
            let task = book
                .task(id)
                .ok_or_else(|| CliError::new("not_found", format!("no task T{id}")))?;
            ctx.out.json(&Shown { goals: book.chain(task.goal), tasks: vec![task] });
        }
        TaskCmd::Add { title, goal, fields } => {
            let project = project_root(fields.project.as_deref().unwrap_or("."))?;
            let task = Task {
                id: 0,
                goal,
                title,
                outcome: fields.outcome.filter(|o| !o.is_empty()),
                text: text_arg(fields.text)?.filter(|t| !t.is_empty()),
                link: fields.link.as_deref().map(book_link).transpose()?.filter(|l| !l.is_empty()),
                project: Some(project).filter(|p| !p.is_empty()),
                owner: fields.owner.filter(|o| !o.is_empty()),
                state: TaskState::Todo,
                priority: fields.priority.and_then(|l| l.0),
                created_at: 0,
                started_at: None,
                ended_at: None,
                sessions: Vec::new(),
            };
            let id = books.change(|books, book| {
                let (book, id) = goals::add_task(book, task, now_ms())?;
                Ok((touched(books, book, id, caller.as_ref())?, id))
            })?;
            println!("{id}");
        }
        TaskCmd::Update { id, title, goal, state, rank, fields } => {
            let change = TaskChange {
                title,
                outcome: fields.outcome,
                text: text_arg(fields.text)?,
                link: fields.link.as_deref().map(book_link).transpose()?,
                project: fields.project.as_deref().map(project_root).transpose()?,
                owner: fields.owner,
                goal,
                state,
                priority: fields.priority.map(|l| l.0),
                rank,
            };
            books.change(|books, book| {
                let book = goals::update_task(book, id, change, now_ms())?;
                Ok((touched(books, book, id, caller.as_ref())?, ()))
            })?;
        }
        TaskCmd::Delete { id } => {
            books.change(|_, book| Ok((goals::delete_task(book, id)?, ())))?
        }
    }
    Ok(())
}

/// The book with the caller's session recorded on the task, with its role then.
fn touched(
    books: &Books,
    book: Goals,
    task: u64,
    caller: Option<&Caller>,
) -> Result<Goals, BookError> {
    let Some(caller) = caller else { return Ok(book) };
    let s = roles::session_of(caller, now_ms());
    let role = books.read::<Roles>()?.of(caller.agent, &caller.session).map(|r| r.name.clone());
    let session = TaskSession {
        role,
        agent: s.agent,
        id: s.id,
        home: s.home,
        path: s.path,
        dir: s.dir,
        at: s.at,
    };
    Ok(goals::touch(book, task, session))
}
