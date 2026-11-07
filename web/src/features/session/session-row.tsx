// A session in a project's list: how it stands and what it is called, and under that where it works
// and since when; one that ran has no mark. A click shows it in the preview tab, a double click keeps
// it.

import { Link, type To } from 'react-router'
import { StatusDot } from '../../components/status-dot'
import type { AgentStatus } from '../../model/state'

type Props = {
  /** A running agent's status, a shell, or a session that ran. */
  mark: AgentStatus | 'shell' | 'ran'
  name: string
  meta: string
  shown: boolean
  to: To
  onKeep: () => void
}

export function SessionRow({ mark, name, meta, shown, to, onKeep }: Props) {
  return (
    <Link
      to={to}
      onDoubleClick={onKeep}
      aria-current={shown ? 'page' : undefined}
      className={`mb-px block rounded-[7px] px-2 pt-[5px] pb-1.5 text-inherit no-underline transition-colors duration-75 hover:bg-hover active:bg-press focus-visible:outline-2 focus-visible:outline-accent ${shown ? 'bg-selected' : ''}`}
    >
      <span
        className={`flex min-w-0 items-center gap-2 text-[13.5px] leading-5 ${shown ? 'font-medium' : ''}`}
      >
        {mark === 'ran' ? (
          <span className="size-2 flex-none" />
        ) : mark === 'shell' ? (
          <span className="size-2 flex-none rounded-[2px] bg-line-strong" />
        ) : (
          <StatusDot status={mark} />
        )}
        <span className="min-w-0 truncate">{name}</span>
      </span>
      <span
        className={`block truncate pl-4 font-mono text-[11.5px] leading-4 ${shown ? 'text-muted' : 'text-faint'}`}
      >
        {meta}
      </span>
    </Link>
  )
}
