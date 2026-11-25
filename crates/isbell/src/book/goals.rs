//! What the user means to get done: goals, a tree of what and why, and the tasks they break into,
//! each followed by one role. Jun's goals, as they are there: goals of one parent come in the order
//! of their importance, tasks of one goal in the order to do them, and an id is one item's for good.

use std::collections::{HashMap, HashSet};

use chrono::{NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use super::caller::Agent;
use super::{Book, BookError, Version, check_link, is_line};

pub const MAX_TITLE: usize = 200;
pub const MAX_OUTCOME: usize = 500;
pub const MAX_TEXT: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum GoalState {
    Open,
    Done,
    Dropped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Todo,
    Doing,
    Done,
    Dropped,
}

impl TaskState {
    fn ended(self) -> bool {
        matches!(self, TaskState::Done | TaskState::Dropped)
    }
}

/// How much a task matters beside the others, whatever their goals. P2, as the rest, is kept as
/// none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Priority {
    P0,
    P1,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Goals {
    pub version: Version,
    pub last_goal: u64,
    pub last_task: u64,
    pub goals: Vec<Goal>,
    pub tasks: Vec<Task>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Goal {
    pub id: u64,
    /// The goal it serves; none for a top one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<u64>,
    pub title: String,
    /// What counts as done.
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// A date, as 2026-11-28.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    /// The user's plan for it: a month as 2026-11, an ISO week as 2026-W48 or a day as 2026-11-23.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<String>,
    pub state: GoalState,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Task {
    pub id: u64,
    pub goal: u64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// The root of its project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// The role that follows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub state: TaskState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    pub created_at: u64,
    /// When it first became doing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// When it became done or dropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    /// The agent sessions that added or changed it, in the order they first did.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<TaskSession>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskSession {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub agent: Agent,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub dir: String,
    pub at: u64,
}

/// What an update sets: `None` leaves a field, `Some("")` clears an optional one. `rank`, from 1,
/// places the goal among its siblings; 0 leaves it.
#[derive(Default)]
pub struct GoalChange {
    pub title: Option<String>,
    pub outcome: Option<String>,
    pub text: Option<String>,
    pub link: Option<String>,
    pub due: Option<String>,
    pub period: Option<String>,
    /// 0 for a top goal.
    pub parent: Option<u64>,
    pub state: Option<GoalState>,
    pub rank: usize,
}

/// What an update sets, as `GoalChange`; `priority: Some(None)` is P2.
#[derive(Default)]
pub struct TaskChange {
    pub title: Option<String>,
    pub outcome: Option<String>,
    pub text: Option<String>,
    pub link: Option<String>,
    pub project: Option<String>,
    pub owner: Option<String>,
    pub goal: Option<u64>,
    pub state: Option<TaskState>,
    pub priority: Option<Option<Priority>>,
    pub rank: usize,
}

/// Which goals: those not ended, unless `states` or `all` says; `matches` in the title, outcome
/// or text, whatever its case.
#[derive(Default)]
pub struct GoalFilter {
    pub states: Vec<GoalState>,
    pub all: bool,
    pub matches: Option<String>,
}

/// Which tasks, as `GoalFilter`; `goal` takes that goal's and those of the goals under it. The
/// conditions all hold.
#[derive(Default)]
pub struct TaskFilter {
    pub states: Vec<TaskState>,
    pub all: bool,
    pub owner: Option<String>,
    pub project: Option<String>,
    pub goal: Option<u64>,
    pub matches: Option<String>,
}

/// What `goal show` and `task show` give: the goal and those above it, the top one first, and
/// the tasks shown.
#[derive(Serialize)]
pub struct Shown<'a> {
    pub goals: Vec<&'a Goal>,
    pub tasks: Vec<&'a Task>,
}

impl Goals {
    pub fn goal(&self, id: u64) -> Option<&Goal> {
        self.goals.iter().find(|g| g.id == id)
    }

    pub fn task(&self, id: u64) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }

    /// The goal and those above it, the top one first.
    pub fn chain(&self, goal: u64) -> Vec<&Goal> {
        let mut chain: Vec<_> = std::iter::successors(self.goal(goal), |g| self.goal(g.parent?))
            .take(self.goals.len() + 1)
            .collect();
        chain.reverse();
        chain
    }

    /// The goals, each followed by those under it.
    fn tree_order(&self) -> Vec<&Goal> {
        fn walk<'a>(book: &'a Goals, parent: Option<u64>, order: &mut Vec<&'a Goal>) {
            for g in book.goals.iter().filter(|g| g.parent == parent) {
                if order.len() < book.goals.len() {
                    order.push(g);
                    walk(book, Some(g.id), order);
                }
            }
        }
        let mut order = Vec::new();
        walk(self, None, &mut order);
        order
    }
}

/// The book with an open goal added, the last of its siblings, and its id.
pub fn add_goal(book: Goals, mut g: Goal, now: u64) -> Result<(Goals, u64), BookError> {
    g.id = book.last_goal + 1;
    (g.state, g.created_at, g.ended_at) = (GoalState::Open, now, None);
    let id = g.id;
    let mut next = book;
    next.last_goal = id;
    next.goals.push(g);
    next.check()?;
    Ok((next, id))
}

/// The book with a task to do added, the last of its goal's, and its id.
pub fn add_task(book: Goals, mut t: Task, now: u64) -> Result<(Goals, u64), BookError> {
    book.goal(t.goal).ok_or_else(|| no_goal(t.goal))?;
    t.id = book.last_task + 1;
    (t.state, t.created_at, t.started_at, t.ended_at) = (TaskState::Todo, now, None, None);
    t.sessions.clear();
    let id = t.id;
    let mut next = book;
    next.last_task = id;
    next.tasks.push(t);
    next.check()?;
    Ok((next, id))
}

/// The book with the goal changed. One moved to another parent goes last among its new siblings,
/// unless `rank` places it.
pub fn update_goal(book: Goals, id: u64, c: GoalChange, now: u64) -> Result<Goals, BookError> {
    let i = book.goals.iter().position(|g| g.id == id).ok_or_else(|| no_goal(id))?;
    let mut g = book.goals[i].clone();
    set(&mut g.title, c.title);
    set(&mut g.outcome, c.outcome);
    set_optional(&mut g.text, c.text);
    set_optional(&mut g.link, c.link);
    set_optional(&mut g.due, c.due);
    set_optional(&mut g.period, c.period);
    let parent = c.parent.map(|p| Some(p).filter(|p| *p != 0));
    let moved = parent.is_some_and(|p| p != g.parent);
    g.parent = parent.unwrap_or(g.parent);
    if let Some(state) = c.state.filter(|s| *s != g.state) {
        (g.state, g.ended_at) = (state, (state != GoalState::Open).then_some(now));
    }
    let siblings = g.parent;
    let mut next = book;
    next.goals = place(next.goals, i, g, moved, c.rank, |o| o.parent == siblings);
    next.check()?;
    Ok(next)
}

/// The book with the task changed, its times following its state: doing first starts it, done or
/// dropped ends it, todo starts it over.
pub fn update_task(book: Goals, id: u64, c: TaskChange, now: u64) -> Result<Goals, BookError> {
    let i = book.tasks.iter().position(|t| t.id == id).ok_or_else(|| no_task(id))?;
    let mut t = book.tasks[i].clone();
    set(&mut t.title, c.title);
    set_optional(&mut t.outcome, c.outcome);
    set_optional(&mut t.text, c.text);
    set_optional(&mut t.link, c.link);
    set_optional(&mut t.project, c.project);
    set_optional(&mut t.owner, c.owner);
    let moved = c.goal.is_some_and(|g| g != t.goal);
    t.goal = c.goal.unwrap_or(t.goal);
    t.priority = c.priority.unwrap_or(t.priority);
    if let Some(state) = c.state.filter(|s| *s != t.state) {
        (t.state, t.ended_at) = (state, state.ended().then_some(now));
        if state == TaskState::Todo {
            t.started_at = None;
        } else if state == TaskState::Doing && t.started_at.is_none() {
            t.started_at = Some(now);
        }
    }
    let siblings = t.goal;
    let mut next = book;
    next.tasks = place(next.tasks, i, t, moved, c.rank, |o| o.goal == siblings);
    next.check()?;
    Ok(next)
}

/// The book with the session recorded as one that touched the task, once.
pub fn touch(mut book: Goals, task: u64, s: TaskSession) -> Goals {
    if let Some(t) = book.tasks.iter_mut().find(|t| t.id == task)
        && !t.sessions.iter().any(|o| o.agent == s.agent && o.id == s.id)
    {
        t.sessions.push(s);
    }
    book
}

/// The book without the goal, one nothing is under: any other is dropped instead, for its history
/// to stay.
pub fn delete_goal(mut book: Goals, id: u64) -> Result<Goals, BookError> {
    book.goal(id).ok_or_else(|| no_goal(id))?;
    if book.goals.iter().any(|g| g.parent == Some(id)) || book.tasks.iter().any(|t| t.goal == id) {
        return Err(BookError::invalid(format!(
            "goal G{id} has goals or tasks under it: set its state to dropped instead"
        )));
    }
    book.goals.retain(|g| g.id != id);
    Ok(book)
}

/// The book without the task, one not started: any other is dropped instead.
pub fn delete_task(mut book: Goals, id: u64) -> Result<Goals, BookError> {
    let state = book.task(id).ok_or_else(|| no_task(id))?.state;
    if state != TaskState::Todo {
        return Err(BookError::invalid(format!(
            "task T{id} is {}: set its state to dropped instead",
            format!("{state:?}").to_lowercase()
        )));
    }
    book.tasks.retain(|t| t.id != id);
    Ok(book)
}

/// The goals the filter picks, in the tree's order.
pub fn select_goals<'a>(book: &'a Goals, f: &GoalFilter) -> Vec<&'a Goal> {
    let picked = |g: &&Goal| {
        picked(f.all, &f.states, g.state, g.state != GoalState::Open)
            && found(&f.matches, [Some(&g.title), Some(&g.outcome), g.text.as_ref()])
    };
    book.tree_order().into_iter().filter(picked).collect()
}

/// The tasks the filter picks, by their goals in the tree's order, then in their goal's.
pub fn select_tasks<'a>(book: &'a Goals, f: &TaskFilter) -> Vec<&'a Task> {
    let rank: HashMap<u64, usize> =
        book.tree_order().iter().enumerate().map(|(i, g)| (g.id, i)).collect();
    let under = |goal: u64| f.goal.is_none_or(|top| book.chain(goal).iter().any(|g| g.id == top));
    let same = |want: &Option<String>, have: &Option<String>| {
        want.as_ref()
            .is_none_or(|w| have.as_ref().is_some_and(|h| h.to_lowercase() == w.to_lowercase()))
    };
    let mut tasks: Vec<_> = book
        .tasks
        .iter()
        .filter(|t| {
            picked(f.all, &f.states, t.state, t.state.ended())
                && under(t.goal)
                && same(&f.owner, &t.owner)
                && same(&f.project, &t.project)
                && found(&f.matches, [Some(&t.title), t.outcome.as_ref(), t.text.as_ref()])
        })
        .collect();
    tasks.sort_by_key(|t| rank.get(&t.goal).copied().unwrap_or(usize::MAX));
    tasks
}

/// Whether the state is one asked for: those given, all, or by default those not ended.
fn picked<S: PartialEq>(all: bool, states: &[S], state: S, ended: bool) -> bool {
    if states.is_empty() { all || !ended } else { states.contains(&state) }
}

fn found<const N: usize>(text: &Option<String>, fields: [Option<&String>; N]) -> bool {
    let Some(text) = text else { return true };
    let text = text.to_lowercase();
    fields.into_iter().flatten().any(|f| f.to_lowercase().contains(&text))
}

fn set(to: &mut String, from: Option<String>) {
    if let Some(from) = from {
        *to = from;
    }
}

fn set_optional(to: &mut Option<String>, from: Option<String>) {
    if let Some(from) = from {
        *to = Some(from).filter(|f| !f.is_empty());
    }
}

/// The items with the item, changed, back in: where it was, last when it moved to other siblings,
/// or at `rank` among its siblings.
fn place<T>(
    mut items: Vec<T>,
    i: usize,
    item: T,
    moved: bool,
    rank: usize,
    sibling: impl Fn(&T) -> bool,
) -> Vec<T> {
    if !moved && rank == 0 {
        items[i] = item;
        return items;
    }
    items.remove(i);
    let at = (rank > 0)
        .then(|| items.iter().enumerate().filter(|(_, o)| sibling(o)).nth(rank - 1).map(|(j, _)| j))
        .flatten()
        .unwrap_or(items.len());
    items.insert(at, item);
    items
}

fn no_goal(id: u64) -> BookError {
    BookError::not_found(format!("no goal G{id}"))
}

fn no_task(id: u64) -> BookError {
    BookError::not_found(format!("no task T{id}"))
}

impl Book for Goals {
    const FILE: &'static str = "goals.json";

    /// IDs are each one item's and none past the last given; a goal's parent is a goal not under
    /// it; a task's goal is there; fields hold their forms; a state goes with its times; a session
    /// touches a task once.
    fn check(&self) -> Result<(), BookError> {
        let mut goals = HashSet::new();
        for g in &self.goals {
            if g.id < 1 || g.id > self.last_goal || !goals.insert(g.id) {
                return Err(BookError::invalid(format!(
                    "goal {}: id is not its own, from 1 to the last given, {}",
                    g.id, self.last_goal
                )));
            }
            check_goal(g).map_err(|e| BookError::invalid(format!("goal G{}: {e}", g.id)))?;
        }
        for g in &self.goals {
            if let Some(parent) = g.parent
                && (!goals.contains(&parent) || self.chain(g.id).len() > self.goals.len())
            {
                return Err(BookError::invalid(format!(
                    "goal G{}: parent {parent} is no goal it can serve",
                    g.id
                )));
            }
        }
        let mut tasks = HashSet::new();
        for t in &self.tasks {
            if t.id < 1 || t.id > self.last_task || !tasks.insert(t.id) {
                return Err(BookError::invalid(format!(
                    "task {}: id is not its own, from 1 to the last given, {}",
                    t.id, self.last_task
                )));
            }
            if !goals.contains(&t.goal) {
                return Err(not_there(t));
            }
            check_task(t).map_err(|e| BookError::invalid(format!("task T{}: {e}", t.id)))?;
        }
        Ok(())
    }
}

fn not_there(t: &Task) -> BookError {
    BookError::not_found(format!("task T{}: goal {} is not there", t.id, t.goal))
}

fn check_goal(g: &Goal) -> Result<(), String> {
    if (g.state != GoalState::Open) != g.ended_at.is_some() {
        return Err("endedAt goes with done and dropped only".into());
    }
    if g.due.as_deref().is_some_and(|d| !is_date(d)) {
        return Err(format!(
            "due {:?} is not a date as 2026-11-28",
            g.due.as_deref().unwrap_or_default()
        ));
    }
    if g.period.as_deref().is_some_and(|p| !is_period(p)) {
        return Err(format!(
            "period {:?} is none of a month as 2026-11, an ISO week as 2026-W48 or a day as 2026-11-23",
            g.period.as_deref().unwrap_or_default()
        ));
    }
    check_fields(&g.title, Some(&g.outcome), g.text.as_deref(), g.link.as_deref())
}

fn check_task(t: &Task) -> Result<(), String> {
    if t.state.ended() != t.ended_at.is_some() {
        return Err("endedAt goes with done and dropped only".into());
    }
    if t.state == TaskState::Todo && t.started_at.is_some() {
        return Err("a task to do has no startedAt".into());
    }
    let mut seen = HashSet::new();
    if let Some(s) =
        t.sessions.iter().find(|s| s.id.is_empty() || !seen.insert((s.agent, s.id.as_str())))
    {
        return Err(format!("{} session {:?} is not one of its own", s.agent.as_str(), s.id));
    }
    check_fields(&t.title, t.outcome.as_ref(), t.text.as_deref(), t.link.as_deref())
}

/// What goals and tasks both have.
fn check_fields(
    title: &str,
    outcome: Option<&String>,
    text: Option<&str>,
    link: Option<&str>,
) -> Result<(), String> {
    if !is_line(title, MAX_TITLE) {
        return Err(format!("the title must be one line of 1 to {MAX_TITLE} bytes"));
    }
    if outcome.is_some_and(|o| !is_line(o, MAX_OUTCOME)) {
        return Err(format!("the outcome must be one line of 1 to {MAX_OUTCOME} bytes"));
    }
    if text.is_some_and(|t| t.len() > MAX_TEXT) {
        return Err(format!(
            "the text has more than {MAX_TEXT} bytes: write it in a file and link to that"
        ));
    }
    link.map_or(Ok(()), |l| check_link(l, false).map_err(|e| e.message))
}

fn is_date(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// A month, an ISO week of a year that has it, or a day.
fn is_period(s: &str) -> bool {
    let digits = |p: &str, n: usize| p.len() == n && p.bytes().all(|b| b.is_ascii_digit());
    let week =
        s.split_once("-W").filter(|(y, w)| digits(y, 4) && digits(w, 2)).and_then(|(y, w)| {
            NaiveDate::from_isoywd_opt(y.parse().ok()?, w.parse().ok()?, Weekday::Mon)
        });
    week.is_some() || (s.len() == 7 && is_date(&format!("{s}-01"))) || is_date(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goal(title: &str, parent: Option<u64>) -> Goal {
        Goal {
            id: 0,
            parent,
            title: title.into(),
            outcome: "done".into(),
            text: None,
            link: None,
            due: None,
            period: None,
            state: GoalState::Open,
            created_at: 0,
            ended_at: None,
        }
    }

    fn task(title: &str, goal: u64) -> Task {
        Task {
            id: 0,
            goal,
            title: title.into(),
            outcome: None,
            text: None,
            link: None,
            project: None,
            owner: None,
            state: TaskState::Todo,
            priority: None,
            created_at: 0,
            started_at: None,
            ended_at: None,
            sessions: Vec::new(),
        }
    }

    fn state(s: TaskState) -> TaskChange {
        TaskChange { state: Some(s), ..TaskChange::default() }
    }

    /// G1 with tasks T1, T2, T3.
    fn book() -> Goals {
        let (b, g) = add_goal(Goals::default(), goal("G", None), 1).unwrap();
        ["a", "b", "c"].iter().fold(b, |b, t| add_task(b, task(t, g), 1).unwrap().0)
    }

    fn titles(b: &Goals) -> Vec<&str> {
        b.tasks.iter().map(|t| t.title.as_str()).collect()
    }

    #[test]
    fn a_task_keeps_the_times_of_its_state() {
        let b = update_task(book(), 1, state(TaskState::Doing), 10).unwrap();
        let b = update_task(b, 1, state(TaskState::Done), 20).unwrap();
        let t = b.task(1).unwrap();
        assert_eq!((t.started_at, t.ended_at), (Some(10), Some(20)));
        let b = update_task(b, 1, state(TaskState::Doing), 30).unwrap();
        assert_eq!((b.task(1).unwrap().started_at, b.task(1).unwrap().ended_at), (Some(10), None));
        let b = update_task(b, 1, state(TaskState::Todo), 40).unwrap();
        assert_eq!(b.task(1).unwrap().started_at, None);
    }

    #[test]
    fn rank_places_a_task_among_its_goals_and_a_moved_one_goes_last() {
        let b = update_task(book(), 3, TaskChange { rank: 1, ..TaskChange::default() }, 1).unwrap();
        assert_eq!(titles(&b), ["c", "a", "b"]);
        let (b, g2) = add_goal(b, goal("G2", None), 1).unwrap();
        let b = add_task(b, task("d", g2), 1).unwrap().0;
        let b =
            update_task(b, 3, TaskChange { goal: Some(g2), ..TaskChange::default() }, 1).unwrap();
        assert_eq!(titles(&b), ["a", "b", "d", "c"]);
        assert_eq!(
            select_tasks(&b, &TaskFilter { goal: Some(g2), ..TaskFilter::default() }).len(),
            2
        );
    }

    #[test]
    fn only_what_has_no_history_is_taken_out() {
        let b = update_task(book(), 1, state(TaskState::Doing), 1).unwrap();
        assert!(delete_task(b, 1).is_err());
        assert!(delete_goal(book(), 1).is_err());
        let b =
            ["a", "b", "c"].iter().zip(1..).fold(book(), |b, (_, id)| delete_task(b, id).unwrap());
        let b = delete_goal(b, 1).unwrap();
        let (b, id) = add_goal(b, goal("again", None), 1).unwrap();
        assert_eq!((id, b.last_task), (2, 3), "ids never come back");
    }

    #[test]
    fn a_goal_serves_none_under_it() {
        let (b, g2) = add_goal(book(), goal("under", Some(1)), 1).unwrap();
        assert_eq!(b.chain(g2).iter().map(|g| g.id).collect::<Vec<_>>(), [1, 2]);
        assert!(
            update_goal(b, 1, GoalChange { parent: Some(g2), ..GoalChange::default() }, 1).is_err()
        );
    }

    #[test]
    fn fields_hold_their_forms() {
        let ok = |p: &str| {
            let change = GoalChange { period: Some(p.into()), ..GoalChange::default() };
            update_goal(book(), 1, change, 1).is_ok()
        };
        assert!(ok("2026-11") && ok("2026-W48") && ok("2026-11-23") && ok(""));
        assert!(!ok("2026-W54") && !ok("2026-1") && !ok("next week"));
        let blank = TaskChange { title: Some(String::new()), ..TaskChange::default() };
        assert!(update_task(book(), 1, blank, 1).is_err());
        let link = TaskChange { link: Some("file:notes.md".into()), ..TaskChange::default() };
        assert!(update_task(book(), 1, link, 1).is_err());
    }

    #[test]
    fn lists_leave_ended_out_unless_asked() {
        let b = update_task(book(), 2, state(TaskState::Done), 1).unwrap();
        let open: Vec<_> = select_tasks(&b, &TaskFilter::default()).iter().map(|t| t.id).collect();
        assert_eq!(open, [1, 3]);
        assert_eq!(select_tasks(&b, &TaskFilter { all: true, ..TaskFilter::default() }).len(), 3);
        let found = TaskFilter { matches: Some("B".into()), all: true, ..TaskFilter::default() };
        assert_eq!(select_tasks(&b, &found).iter().map(|t| t.id).collect::<Vec<_>>(), [2]);
    }
}
