// What a goal or a task opened in the Goals tab is, under its row: the short of it side by side, what
// counts as done, the notes, link and sessions a line each. A task's owner, while an agent runs that
// role, is looked at from here; the sessions that touched it and a file it links to open in tabs.

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useI18n } from '../../../core/i18n'
import { useProjects } from '../../../core/space'
import { useTabActions } from '../../../core/tabs'
import { AGENT_NAMES } from '../../../features/session/session-row'
import { rootHolding } from '../../../model/files/worktrees'
import { type Goal, type Progress, periodLabel, type Task } from '../../../model/goals'
import type { Placed } from '../../../model/projects'
import { closedTabId } from '../../../model/tabs'
import { usePeek } from '../peek'
import { fileTabId } from '../tab-kinds'
import { PRIORITIES, STATES } from '../task-row'

const LINK = 'text-accent no-underline hover:underline'

/** A label, its value, and whether it takes a line of its own. */
type Field = [string, ReactNode, boolean?]

/** `inset`: how far in it starts, for its text to line up with the row's title. */
function Fields({ fields, inset }: { fields: Field[]; inset: number }) {
  return (
    <dl
      style={{ marginLeft: inset }}
      className="m-0 mt-0.5 mr-2 mb-1.5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-7 gap-y-[7px] rounded-lg border border-line bg-raised px-3.5 pt-2.5 pb-3 text-[12.5px]"
    >
      {fields
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value, wide]) => (
          <div
            key={label}
            className={`grid grid-cols-[72px_minmax(0,1fr)] gap-3 ${wide ? 'col-span-full' : ''}`}
          >
            <dt className="whitespace-nowrap text-faint">{label}</dt>
            <dd className="m-0 whitespace-pre-line [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
    </dl>
  )
}

/** A file under one of the machine's projects opens in a tab; anything else reads as it is. */
function LinkValue({ mid, value }: { mid: string; value: string }) {
  const { href } = useTabActions()
  const projects = useProjects()
  const abs = value.replace(/^file:/, '')
  const roots = projects
    .filter(p => p.mid === mid && p.path)
    .map(p => ({ key: p.key, path: p.path, display: p.display, branch: null, own: true }))
  const found = value.startsWith('file:') ? rootHolding(roots, abs) : undefined
  return found ? (
    <Link to={href(fileTabId(found.root.key, found.rel))} className={LINK}>
      {abs}
    </Link>
  ) : (
    value
  )
}

type Common = { mid: string; inset: number; day: (ms: number) => string }

export function GoalDetail({
  mid,
  goal,
  progress,
  inset,
  day,
}: Common & { goal: Goal; progress: Progress | undefined }) {
  const t = useI18n()
  const state =
    goal.state === 'open'
      ? t('goals.doing')
      : goal.endedAt &&
        t(goal.state === 'done' ? 'goals.doneOn' : 'goals.droppedOn', { d: day(goal.endedAt) })
  return (
    <Fields
      inset={inset}
      fields={[
        [t('goals.state'), state],
        [t('goals.period'), goal.period && `${periodLabel(t.locale, goal.period)} (${goal.period})`],
        [t('goals.due'), goal.due],
        [t('goals.progress'), progress?.total ? `${progress.done} / ${progress.total}` : undefined],
        [t('tasks.outcome'), goal.outcome, true],
        [t('tasks.text'), goal.text, true],
        [t('tasks.link'), goal.link && <LinkValue mid={mid} value={goal.link} />, true],
      ]}
    />
  )
}

type TaskProps = Common & {
  task: Task
  /** The agent running its owner's role, if one does. */
  agent: Placed | undefined
  project: string | undefined
}

export function TaskDetail({ mid, task, agent, project, inset, day }: TaskProps) {
  const t = useI18n()
  const { href } = useTabActions()
  const { open: peekAt } = usePeek()
  const state = STATES[task.state]
  const times = [
    t('goals.added', { d: day(task.createdAt) }),
    task.startedAt && t('goals.started', { d: day(task.startedAt) }),
    task.endedAt && t(task.state === 'done' ? 'goals.doneOn' : 'goals.droppedOn', { d: day(task.endedAt) }),
  ]
  const stateCell = (
    <>
      <span className={state.tone}>{state.glyph}</span> {t(`goals.${task.state}`)}
      {task.priority ? (
        <span className={`ml-1.5 font-mono text-[10.5px] font-semibold ${PRIORITIES[task.priority]}`}>
          {task.priority}
        </span>
      ) : null}
    </>
  )
  const ownerCell =
    task.owner && agent ? (
      <button
        type="button"
        onClick={() => peekAt(agent)}
        title={t('tasks.peek', { name: task.owner })}
        className={`cursor-pointer border-0 bg-transparent p-0 ${LINK}`}
      >
        {task.owner}
      </button>
    ) : (
      task.owner
    )
  const sessionsCell = task.sessions.length ? (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {task.sessions.map(s => (
        <Link key={`${s.agent}:${s.id}`} to={href(closedTabId(mid, s.agent, s.id))} className={LINK}>
          {[s.role, AGENT_NAMES[s.agent] ?? s.agent, day(s.at)].filter(Boolean).join(' · ')}
        </Link>
      ))}
    </span>
  ) : undefined
  return (
    <Fields
      inset={inset}
      fields={[
        [t('goals.state'), stateCell],
        [t('goals.owner'), ownerCell],
        [t('goals.project'), project],
        [t('goals.times'), times.filter(Boolean).join(' · ')],
        [t('tasks.outcome'), task.outcome, true],
        [t('tasks.text'), task.text, true],
        [t('tasks.link'), task.link && <LinkValue mid={mid} value={task.link} />, true],
        [t('tasks.sessions'), sessionsCell, true],
      ]}
    />
  )
}
