// A session in a project's list: how it stands, or the agent it ran under, what it is called and
// when, and under that what it is at and any worktree's branch. A click shows it in the preview tab,
// a double click keeps it.

import { Clock } from 'lucide-react'
import { Link, type To } from 'react-router'
import { StatusDot } from '../../components/status-dot'
import type { AgentStatus } from '../../model/state'

type Mark = AgentStatus | 'shell' | { agent: string }

type Props = {
  /** A running agent's status, a shell, or the agent of a session that ran. */
  mark: Mark
  name: string
  detail?: string | undefined
  /** `detail` says the agent is asking. */
  asking?: boolean | undefined
  branch?: string | undefined
  time?: string | undefined
  /** It has a scheduled message running. */
  looping?: boolean | undefined
  /** Shown on hovering the row. */
  hint?: string | undefined
  /** What is searched for, in lower case, to pick out. */
  needle: string
  shown: boolean
  to: To
  onKeep: () => void
}

const LETTERS: Readonly<Record<string, string>> = { claude: 'C', codex: 'X', pi: 'π' }

function MarkOf({ mark }: { mark: Mark }) {
  if (typeof mark === 'object')
    return (
      <span
        title={mark.agent}
        className="w-2 flex-none text-center font-mono text-[10.5px] font-medium text-faint"
      >
        {LETTERS[mark.agent] ?? mark.agent.charAt(0).toUpperCase()}
      </span>
    )
  if (mark === 'shell') return <span className="size-2 flex-none rounded-[2px] bg-line-strong" />
  return <StatusDot status={mark} />
}

export function Marked({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return text
  const end = at + needle.length
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-accent-soft px-px text-inherit">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export function SessionRow({
  mark,
  name,
  detail,
  asking,
  branch,
  time,
  looping,
  hint,
  needle,
  shown,
  to,
  onKeep,
}: Props) {
  const under = detail || branch
  return (
    <Link
      to={to}
      title={hint}
      onDoubleClick={onKeep}
      aria-current={shown ? 'page' : undefined}
      className={`mb-px block rounded-[7px] px-2 text-inherit no-underline transition-colors duration-75 hover:bg-hover active:bg-press focus-visible:outline-2 focus-visible:outline-accent ${under ? 'pt-[5px] pb-1.5' : 'py-[3px]'} ${shown ? 'bg-selected' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-2 text-[13.5px] leading-5">
        <MarkOf mark={mark} />
        <span className="min-w-0 flex-1 truncate">
          <Marked text={name} needle={needle} />
        </span>
        {looping ? <Clock size={11} className="flex-none text-faint" /> : null}
        {time ? (
          <span className="flex-none font-mono text-[11.5px] text-faint tabular-nums">{time}</span>
        ) : null}
      </span>
      {under ? (
        <span
          className={`flex min-w-0 gap-1.5 pl-4 text-xs leading-4 ${shown ? 'text-muted' : 'text-faint'}`}
        >
          <span className={`min-w-0 flex-1 truncate ${asking ? 'font-medium text-warn' : ''}`}>
            {detail ? <Marked text={detail} needle={needle} /> : null}
          </span>
          {branch ? (
            <span className="max-w-24 flex-none truncate font-mono text-[11px] text-muted">{branch}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  )
}
