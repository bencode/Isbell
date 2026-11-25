// A task in the right column, on one line: its state, number, title, priority and the role that
// follows it, with what it is for under it where it stands apart from its goal. Opening it shows the
// rest of it in place; the role's name looks at the agent that runs it, if one does.

import { useI18n } from '../../core/i18n'
import { AGENT_NAMES } from '../../features/session/session-row'
import { ended, type Task, type TaskState } from '../../model/goals'
import { shortDay } from '../../utils/time'

const STATES: Readonly<Record<TaskState, { glyph: string; tone: string }>> = {
  todo: { glyph: '○', tone: 'text-faint' },
  doing: { glyph: '◐', tone: 'text-accent' },
  done: { glyph: '✓', tone: 'text-ok' },
  dropped: { glyph: '✕', tone: 'text-faint' },
}

const PRIORITIES = { P0: 'text-danger', P1: 'text-warn' }

type Props = {
  task: Task
  /** Its goal, and machine if need be, where the list is not by goal. */
  under?: string | undefined
  /** Looks at the agent running its owner's role; none runs it without one. */
  onPeek?: (() => void) | undefined
  open: boolean
  onToggle: () => void
  now: number
}

export function TaskRow({ task, under, onPeek, open, onToggle, now }: Props) {
  const t = useI18n()
  const state = STATES[task.state]
  return (
    <div className="flex flex-none flex-col">
      <div
        className={`relative flex flex-none items-center gap-1.5 rounded-[7px] px-1.5 py-1 transition-colors duration-75 ${open ? 'bg-selected' : 'hover:bg-hover'}`}
      >
        <span aria-hidden className={`w-3.5 flex-none text-center text-xs leading-none ${state.tone}`}>
          {state.glyph}
        </span>
        <span className="min-w-[26px] flex-none font-mono text-[11px] text-faint">T{task.id}</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] leading-5 outline-none after:absolute after:inset-0 after:rounded-[7px] focus-visible:after:outline-2 focus-visible:after:outline-accent ${ended(task.state) ? 'text-faint' : 'text-text'}`}
        >
          {task.title}
        </button>
        {task.priority ? (
          <span className={`flex-none font-mono text-[10.5px] font-semibold ${PRIORITIES[task.priority]}`}>
            {task.priority}
          </span>
        ) : null}
        {task.owner && onPeek ? (
          <button
            type="button"
            onClick={onPeek}
            title={t('tasks.peek', { name: task.owner })}
            className="relative z-[1] max-w-[72px] flex-none cursor-pointer truncate rounded border-0 bg-transparent px-0.5 text-xs text-text underline decoration-line-strong decoration-dotted underline-offset-[3px] hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            {task.owner}
          </button>
        ) : task.owner ? (
          <span className="max-w-[72px] flex-none truncate px-0.5 text-xs text-muted">{task.owner}</span>
        ) : null}
      </div>
      {under ? (
        <span className="-mt-1 truncate pr-1.5 pb-1 pl-[52px] text-[11.5px] leading-4 text-faint">
          {under}
        </span>
      ) : null}
      {open ? <Detail task={task} now={now} /> : null}
    </div>
  )
}

function Detail({ task, now }: { task: Task; now: number }) {
  const t = useI18n()
  const sessions = task.sessions.map(s =>
    [s.role, AGENT_NAMES[s.agent] ?? s.agent, shortDay(t.locale, s.at, now, t('sessions.yesterday'))]
      .filter(Boolean)
      .join(' · '),
  )
  const rows = [
    { label: t('tasks.outcome'), value: task.outcome },
    { label: t('tasks.text'), value: task.text },
    { label: t('tasks.link'), value: task.link },
    { label: t('tasks.sessions'), value: sessions.length ? sessions.join('\n') : undefined },
  ].filter(row => row.value)
  return (
    <dl className="m-0 mt-0.5 mr-1.5 mb-1.5 ml-[26px] grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-[7px] border border-line bg-raised px-2.5 py-2 text-xs">
      {rows.length ? (
        rows.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="whitespace-nowrap text-faint">{label}</dt>
            <dd className="m-0 whitespace-pre-line text-text [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))
      ) : (
        <dd className="col-span-2 m-0 text-faint">—</dd>
      )}
    </dl>
  )
}
