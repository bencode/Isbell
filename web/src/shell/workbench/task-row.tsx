// A task in the right column, on one line: its state, number, title, priority and the role that
// follows it, with what it is for under it where it stands apart from its goal. Clicked, the rest of
// it floats beside the column, too narrow to hold it; the role's name looks at the agent that runs
// it, if one does.

import { Popover } from '@base-ui/react/popover'
import { useI18n } from '../../core/i18n'
import { AGENT_NAMES } from '../../features/session/session-row'
import { ended, type Task, type TaskState } from '../../model/goals'
import { shortDay } from '../../utils/time'

export const STATES: Readonly<Record<TaskState, { glyph: string; tone: string }>> = {
  todo: { glyph: '○', tone: 'text-faint' },
  doing: { glyph: '◐', tone: 'text-accent' },
  done: { glyph: '✓', tone: 'text-ok' },
  dropped: { glyph: '✕', tone: 'text-faint' },
}

export const PRIORITIES = { P0: 'text-danger', P1: 'text-warn' }

type Props = {
  task: Task
  /** Its goal, and machine if need be, where the list is not by goal. */
  under?: string | undefined
  /** Looks at the agent running its owner's role; none runs it without one. */
  onPeek?: (() => void) | undefined
  now: number
}

export function TaskRow({ task, under, onPeek, now }: Props) {
  const t = useI18n()
  const state = STATES[task.state]
  return (
    <div className="flex flex-none flex-col">
      <div className="relative flex flex-none items-center gap-1.5 rounded-[7px] px-1.5 py-1 transition-colors duration-75 hover:bg-hover has-[[data-popup-open]]:bg-selected">
        <span aria-hidden className={`w-3.5 flex-none text-center text-xs leading-none ${state.tone}`}>
          {state.glyph}
        </span>
        <span className="min-w-[26px] flex-none font-mono text-[11px] text-faint">T{task.id}</span>
        <Popover.Root>
          <Popover.Trigger
            className={`min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] leading-5 outline-none after:absolute after:inset-0 after:rounded-[7px] focus-visible:after:outline-2 focus-visible:after:outline-accent ${ended(task.state) ? 'text-faint' : 'text-text'}`}
          >
            {task.title}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="left" align="start" sideOffset={10} className="z-50 outline-none">
              <Popover.Popup className="max-h-[70vh] w-[300px] overflow-auto rounded-[10px] border border-line-strong bg-raised px-3 py-2.5 text-xs text-text shadow-[0_8px_28px_rgb(0_0_0/0.2)] outline-none">
                <Detail task={task} now={now} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
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
    <>
      <p className="m-0 text-[13px] leading-5 font-semibold [overflow-wrap:anywhere]">
        <span className="mr-1.5 font-mono text-[11px] font-normal text-faint">T{task.id}</span>
        {task.title}
      </p>
      {rows.length ? (
        <dl className="m-0 mt-2 flex flex-col gap-2">
          {rows.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-[11px] text-faint">{label}</dt>
              <dd className="m-0 whitespace-pre-line [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  )
}
