// The pieces of the phone's Tasks: tasks in a card, each its state, title, number, priority, the role
// that follows it and what it is under; goals with how far they are; a file a task gave, opened to
// read; the messages about one. Each goes where it says.

import { FileText, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { RoleAvatar } from '../../../components/role-avatar'
import { type Shelf, useRunningRoles, useRunningSession } from '../../../core/books'
import { type Key, useI18n } from '../../../core/i18n'
import { useProjects } from '../../../core/space'
import { AGENT_NAMES } from '../../../features/session/session-row'
import { projectHolding } from '../../../model/files/worktrees'
import {
  ended,
  type Goal,
  type Progress,
  periodLabel,
  progressOf,
  type Task,
  type TaskState,
} from '../../../model/goals'
import { lastActive, type Message, type MessageKind } from '../../../model/messages'
import type { Placed } from '../../../model/projects'
import { roleKey } from '../../../model/roles'
import { projectFilesHref, sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'
import { BackButton, PhoneBar } from '../bar'

export const taskHref = (mid: string, id: number) => `/tasks/${encodeURIComponent(mid)}/${id}`
export const goalHref = (mid: string, id: number) => `/goals/${encodeURIComponent(mid)}/${id}`

/** A task, with the machine it is on. */
export type Item = { shelf: Shelf; task: Task }

export const STATE_NAMES: Readonly<Record<TaskState, Key>> = {
  todo: 'goals.todo',
  doing: 'goals.doing',
  done: 'goals.done',
  dropped: 'goals.dropped',
}

const RINGS: Readonly<Record<TaskState, string>> = {
  todo: 'border-line-strong',
  doing:
    'border-accent bg-[conic-gradient(var(--accent)_0_50%,transparent_50%_100%)] bg-clip-content p-[2px]',
  done: 'border-ok bg-ok',
  dropped: 'border-line-strong bg-line-strong',
}

export function StateRing({ state }: { state: TaskState }) {
  return <span aria-hidden className={`block size-4 flex-none rounded-full border-[1.7px] ${RINGS[state]}`} />
}

const PRIORITIES = { P0: 'bg-danger/15 text-danger', P1: 'bg-warn/15 text-warn' }

export function Priority({ priority }: { priority: keyof typeof PRIORITIES }) {
  return (
    <span
      className={`flex-none rounded px-1 font-mono text-[10px] leading-4 font-semibold ${PRIORITIES[priority]}`}
    >
      {priority}
    </span>
  )
}

/** A role by its face and name, its status that of the agent running it, if one does. */
export function Owner({ name, agent }: { name: string; agent: Placed | undefined }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-medium text-muted">
      <RoleAvatar name={name} size="sm" {...(agent ? { status: agent.session.status } : {})} />
      <span className="truncate">{name}</span>
    </span>
  )
}

const PANEL = 'rounded-2xl border border-line bg-raised'
export const CARD = `${PANEL} flex flex-col divide-y divide-line overflow-hidden`

/** A part of a page: its name, how many it holds, and them. */
export function Section({
  title,
  count,
  children,
}: {
  title: ReactNode
  count?: number
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 px-3 pt-3.5">
      <h2 className="m-0 flex items-baseline gap-1.5 px-1 text-[12.5px] font-semibold text-muted">
        {title}
        {count === undefined ? null : (
          <span className="font-mono text-[11.5px] font-normal text-faint">{count}</span>
        )}
      </h2>
      {children}
    </section>
  )
}

type ListProps = {
  items: Item[]
  /** What each is under, where the list is not by goal. */
  under?: (item: Item) => string | undefined
}

export function TaskList({ items, under }: ListProps) {
  const t = useI18n()
  const agents = useRunningRoles()
  return (
    <div className={CARD}>
      {items.map(item => {
        const { shelf, task } = item
        const where = under?.(item)
        const over = ended(task.state)
        return (
          <Link
            key={`${shelf.mid}:${task.id}`}
            to={taskHref(shelf.mid, task.id)}
            className="flex gap-2.5 px-3 py-2.5 text-text no-underline active:bg-press"
          >
            <span className="pt-0.5">
              <StateRing state={task.state} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={`text-[14px] leading-snug [overflow-wrap:anywhere] ${over ? 'font-medium text-muted' : 'font-semibold'}`}
              >
                {task.title}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
                <span className="flex-none font-mono text-[11px]">T{task.id}</span>
                {task.priority ? <Priority priority={task.priority} /> : null}
                {task.owner ? (
                  <span className="flex max-w-[45%] min-w-0 flex-none">
                    <Owner name={task.owner} agent={agents.get(roleKey(shelf.mid, task.owner))} />
                  </span>
                ) : (
                  <span className="flex-none">{t('mobile.unowned')}</span>
                )}
                {where ? <span className="min-w-0 flex-1 truncate">· {where}</span> : null}
              </span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}

export function Meter({ progress: { done, total } }: { progress: Progress }) {
  return (
    <>
      <span className="h-1 w-10 flex-none overflow-hidden rounded-sm bg-raised-2">
        <span
          className="block h-full rounded-sm bg-ok"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </span>
      <span className="min-w-[30px] flex-none text-right font-mono text-[11px] text-faint">
        {done}/{total}
      </span>
    </>
  )
}

/** A goal's period and due date, short. */
const whenOf = (locale: string, goal: Goal) =>
  [goal.period, goal.due].flatMap(v => (v ? [periodLabel(locale, v)] : [])).join(' · ')

export function GoalList({ shelf, goals }: { shelf: Shelf; goals: Goal[] }) {
  const t = useI18n()
  const progress = progressOf(shelf.book)
  return (
    <div className={CARD}>
      {goals.map(goal => {
        const when = whenOf(t.locale, goal)
        const over = ended(goal.state)
        return (
          <Link
            key={goal.id}
            to={goalHref(shelf.mid, goal.id)}
            className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 text-[13.5px] text-text no-underline active:bg-press"
          >
            <Target aria-hidden size={15} className="flex-none text-faint" />
            <span className={`min-w-0 flex-1 truncate ${over ? 'text-muted' : 'font-medium'}`}>
              {goal.title}
            </span>
            {when ? <span className="flex-none font-mono text-[11px] text-faint">{when}</span> : null}
            <Meter progress={progress.get(goal.id) ?? { done: 0, total: 0 }} />
          </Link>
        )
      })}
    </div>
  )
}

/** A file under one of the machine's projects, opened to read; one elsewhere only says where it is. */
export function FileChip({ mid, path }: { mid: string; path: string }) {
  const t = useI18n()
  const at = projectHolding(useProjects(), mid, path)
  const look =
    'flex min-h-11 min-w-0 items-center gap-2 rounded-[10px] border border-line bg-bg px-2.5 py-1.5 text-text no-underline'
  const body = (
    <>
      <FileText aria-hidden size={15} className="flex-none text-accent" />
      <span className="min-w-0 flex-1 font-mono text-[12px] [overflow-wrap:anywhere]">
        {at ? at.rel || path : path}
      </span>
    </>
  )
  return at ? (
    <Link to={projectFilesHref(at.project.key, at.rel)} className={`${look} active:bg-press`}>
      {body}
      <b className="flex-none text-[12.5px] font-semibold text-accent">{t('mobile.open')}</b>
    </Link>
  ) : (
    <div className={look}>{body}</div>
  )
}

const KINDS: Readonly<Record<MessageKind, { glyph: string; tone: string }>> = {
  ask: { glyph: '?', tone: 'bg-warn/15 text-warn' },
  warn: { glyph: '!', tone: 'bg-danger/15 text-danger' },
  done: { glyph: '✓', tone: 'bg-ok/15 text-ok' },
  info: { glyph: 'i', tone: 'bg-raised-2 text-faint' },
}

/** Messages on a machine, each opening the agent that sent it while it runs. */
export function MessageList({ mid, messages, now }: { mid: string; messages: Message[]; now: number }) {
  const running = useRunningSession()
  return (
    <div className={CARD}>
      {messages.map(message => {
        const { from } = message
        const placed = from && running(mid, from.agent, from.session)
        const who = from && (from.role ?? AGENT_NAMES[from.agent] ?? from.agent)
        const kind = KINDS[message.kind]
        const body = (
          <>
            <span
              aria-hidden
              className={`mt-px grid size-5 flex-none place-items-center rounded-full text-[11px] font-bold ${kind.tone}`}
            >
              {kind.glyph}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-[13.5px] leading-snug font-medium [overflow-wrap:anywhere]">
                {message.title ?? message.text}
              </span>
              <span className="text-[11.5px] text-faint">
                {[who, since(lastActive(message), now)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </>
        )
        const look = 'flex gap-2.5 px-3 py-2.5 text-text no-underline'
        return placed ? (
          <Link
            key={message.id}
            to={sessionHref(placed.session.mid, placed.session.paneId)}
            className={`${look} active:bg-press`}
          >
            {body}
          </Link>
        ) : (
          <div key={message.id} className={look}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

/** A page with only a bar and a line in it: one not read yet, or gone. */
export function Absent({ note }: { note: string }) {
  return (
    <>
      <PhoneBar>
        <BackButton />
      </PhoneBar>
      <p className="m-0 p-4 text-muted">{note}</p>
    </>
  )
}

/** Labels and their values. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl
      className={`${PANEL} m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 px-3.5 py-3 text-[13.5px]`}
    >
      {children}
    </dl>
  )
}

/** A label and its value; none where it has none. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === '') return null
  return (
    <>
      <dt className="pt-px text-[12px] text-faint">{label}</dt>
      <dd className="m-0 min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{children}</dd>
    </>
  )
}
