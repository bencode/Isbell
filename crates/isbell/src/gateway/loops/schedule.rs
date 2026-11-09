//! What a loop asks for and when it is due, apart from anything that reads files or sends messages.

use std::collections::BTreeMap;

use chrono::{DateTime, Days, NaiveTime, TimeZone};
use isbell_proto::state::{Agent, AgentStatus};
use serde::{Deserialize, Serialize};

/// How long an agent must have stood still, so a loop does not cut in on someone working with it.
const QUIET_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Schedule {
    EveryMinutes(u32),
    /// `HH:MM` on the machine's clock.
    DailyAt(String),
}

/// One entry of `loops.json`, which the browser writes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loop {
    pub id: String,
    pub pane_id: String,
    pub schedule: Schedule,
    pub message: String,
    /// Clears the context before the run that follows this many; absent keeps it.
    pub clear_every: Option<u32>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Sent,
    ClearFailed,
    SendFailed,
}

/// How a loop has gone so far, kept by the gateway in `loops-state.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Run {
    pub next_run_at: Option<u64>,
    /// The schedule `next_run_at` was worked out from.
    pub planned: Option<Schedule>,
    pub last_run_at: Option<u64>,
    pub last_result: Option<Outcome>,
    pub runs_since_clear: u32,
}

/// By loop id.
pub type Runs = BTreeMap<String, Run>;

pub fn ms<Tz: TimeZone>(at: &DateTime<Tz>) -> u64 {
    u64::try_from(at.timestamp_millis()).unwrap_or(0)
}

/// When `schedule` next comes after `now`; none for a schedule that makes no sense. A time the
/// clocks skip that day moves on to the next day that has it.
pub fn next_after<Tz: TimeZone>(schedule: &Schedule, now: &DateTime<Tz>) -> Option<u64> {
    match schedule {
        Schedule::EveryMinutes(0) => None,
        Schedule::EveryMinutes(minutes) => Some(ms(now) + u64::from(*minutes) * 60_000),
        Schedule::DailyAt(at) => {
            let at = NaiveTime::parse_from_str(at, "%H:%M").ok()?;
            let today = now.date_naive();
            (0..=2)
                .filter_map(|days| today.checked_add_days(Days::new(days)))
                .filter_map(|day| now.timezone().from_local_datetime(&day.and_time(at)).earliest())
                .find(|candidate| candidate > now)
                .map(|at| ms(&at))
        }
    }
}

/// `run` with its next time worked out: none while paused, so resuming waits a whole period rather
/// than firing at once; afresh when the schedule changed.
pub fn planned<Tz: TimeZone>(l: &Loop, run: Run, now: &DateTime<Tz>) -> Run {
    if !l.enabled {
        return Run { next_run_at: None, planned: None, ..run };
    }
    if run.next_run_at.is_some() && run.planned.as_ref() == Some(&l.schedule) {
        return run;
    }
    Run { next_run_at: next_after(&l.schedule, now), planned: Some(l.schedule.clone()), ..run }
}

/// Whether to send now: it is time, and the agent has stopped and stayed stopped. Otherwise a loop
/// past its time keeps waiting, so what was missed goes out once.
pub fn fires(run: &Run, agent: &Agent, now: u64) -> bool {
    run.next_run_at.is_some_and(|at| now >= at)
        && matches!(agent.status, AgentStatus::Idle | AgentStatus::Done)
        && now.saturating_sub(agent.status_since) >= QUIET_MS
}

pub fn clears(l: &Loop, run: &Run) -> bool {
    l.clear_every.is_some_and(|every| run.runs_since_clear >= every)
}

/// What starts a new conversation in an agent of `kind`. Pi has no `/clear`: it would reach the
/// model as a message.
pub fn clear_command(kind: &str) -> Option<&'static str> {
    match kind {
        "claude" | "codex" => Some("/clear"),
        "pi" => Some("/new"),
        _ => None,
    }
}

/// `run` after a firing; only a message that went out counts as a run, so a failed clear is tried
/// again next time.
pub fn after(run: Run, outcome: Outcome, cleared: bool, now: u64, next: Option<u64>) -> Run {
    let runs_since_clear = match outcome {
        Outcome::Sent if cleared => 1,
        Outcome::Sent => run.runs_since_clear + 1,
        Outcome::ClearFailed | Outcome::SendFailed => run.runs_since_clear,
    };
    Run {
        next_run_at: next,
        last_run_at: Some(now),
        last_result: Some(outcome),
        runs_since_clear,
        ..run
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().expect("a time")
    }

    fn a_loop(schedule: Schedule, clear_every: Option<u32>, enabled: bool) -> Loop {
        Loop {
            id: "l".into(),
            pane_id: "w1:p1".into(),
            schedule,
            message: "go".into(),
            clear_every,
            enabled,
        }
    }

    fn agent(status: AgentStatus, status_since: u64) -> Agent {
        Agent {
            pane_id: "w1:p1".into(),
            name: None,
            kind: Some("codex".into()),
            status,
            status_since,
            cwd: None,
            title: None,
        }
    }

    #[test]
    fn a_daily_time_is_today_until_it_has_passed() {
        let daily = Schedule::DailyAt("08:00".into());
        let before = at("2026-11-09T07:59:00Z");
        let reached = at("2026-11-09T08:00:00Z");
        assert_eq!(next_after(&daily, &before), Some(ms(&at("2026-11-09T08:00:00Z"))));
        assert_eq!(next_after(&daily, &reached), Some(ms(&at("2026-11-10T08:00:00Z"))));
    }

    #[test]
    fn a_schedule_that_makes_no_sense_never_comes() {
        let now = at("2026-11-09T07:59:00Z");
        assert_eq!(next_after(&Schedule::EveryMinutes(0), &now), None);
        assert_eq!(next_after(&Schedule::DailyAt("25:00".into()), &now), None);
    }

    #[test]
    fn a_time_set_is_kept_until_the_schedule_changes() {
        let now = at("2026-11-09T08:00:00Z");
        let every = Schedule::EveryMinutes(10);
        let run = planned(&a_loop(every.clone(), None, true), Run::default(), &now);
        assert_eq!(run.next_run_at, Some(ms(&now) + 600_000));

        let later = at("2026-11-09T08:05:00Z");
        let kept = planned(&a_loop(every, None, true), run.clone(), &later);
        assert_eq!(kept, run);

        let changed = planned(&a_loop(Schedule::EveryMinutes(1), None, true), run, &later);
        assert_eq!(changed.next_run_at, Some(ms(&later) + 60_000));
    }

    #[test]
    fn resuming_waits_a_whole_period() {
        let now = at("2026-11-09T08:00:00Z");
        let every = Schedule::EveryMinutes(10);
        let run = Run { next_run_at: Some(1), planned: Some(every.clone()), ..Run::default() };
        let paused = planned(&a_loop(every.clone(), None, false), run, &now);
        assert_eq!(paused.next_run_at, None);
        let resumed = planned(&a_loop(every, None, true), paused, &now);
        assert_eq!(resumed.next_run_at, Some(ms(&now) + 600_000));
    }

    #[test]
    fn only_an_agent_that_has_stayed_stopped_is_sent_to() {
        let run = Run { next_run_at: Some(1_000), ..Run::default() };
        let now = 100_000;
        assert!(fires(&run, &agent(AgentStatus::Idle, 0), now));
        assert!(fires(&run, &agent(AgentStatus::Done, 0), now));
        assert!(!fires(&run, &agent(AgentStatus::Working, 0), now));
        assert!(!fires(&run, &agent(AgentStatus::Blocked, 0), now));
        assert!(!fires(&run, &agent(AgentStatus::Idle, now - 1_000), now), "stopped only just now");
        assert!(!fires(&Run::default(), &agent(AgentStatus::Idle, 0), now), "paused");
    }

    #[test]
    fn the_context_is_cleared_after_the_runs_asked_for_and_a_failed_clear_is_retried() {
        let l = a_loop(Schedule::EveryMinutes(1), Some(2), true);
        let first = Run::default();
        assert!(!clears(&l, &first), "the first run keeps what is there");

        let once = after(first, Outcome::Sent, false, 1, None);
        let twice = after(once, Outcome::Sent, false, 2, None);
        assert!(clears(&l, &twice));

        let failed = after(twice, Outcome::ClearFailed, true, 3, None);
        assert!(clears(&l, &failed));

        let cleared = after(failed, Outcome::Sent, true, 4, None);
        assert_eq!(cleared.runs_since_clear, 1);
        assert!(!clears(&l, &cleared));
    }
}
