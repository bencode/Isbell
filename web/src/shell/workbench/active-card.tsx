// A session in the right column: a card for one that asks, works or has just finished, a line for
// one finished earlier or standing by. It says the agent and its project, and the machine where
// that project is open on more than one. Opening it looks at it; one that asks can be answered in
// its terminal.

import { SquareTerminal } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import { AgentMark } from '../../features/session/session-row'
import { SessionTime } from '../../features/session/session-time'
import { useCardNote } from '../../features/session/use-agent-note'
import { toolLine } from '../../model/agent-note'
import type { Placed, Session } from '../../model/projects'

type Props = {
  placed: Placed
  now: number
  /** It is the one looked at. */
  peeking: boolean
  /** Its project's name is that of a project on another machine too. */
  sharedName: boolean
  onOpen: (terminal: boolean) => void
}

/** A machine's name without its owner's (`bencodes-Mac-mini` is `Mac-mini`). */
const shortMachine = (name: string) => name.replace(/^[^-]+s-(?=.)/, '')

const projectName = ({ project }: Placed) => (project.configured ? project.name : project.display)

/** The agent's mark; a finished session looked at stands by, as far as the mark goes. */
const markOf = (s: Session) => ({
  agent: s.kind ?? '?',
  status: s.status === 'done' && !s.unread ? ('idle' as const) : s.status,
})

/** Its project, and its machine where the name alone does not say which. */
function where(placed: Placed, sharedName: boolean) {
  const machine = sharedName ? shortMachine(placed.project.machine) : undefined
  return { name: projectName(placed), machine, title: `${projectName(placed)} · ${placed.project.machine}` }
}

export function ActiveCard({ placed, now, peeking, sharedName, onOpen }: Props) {
  const t = useI18n()
  const { session } = placed
  const { tool, asked, topic } = useCardNote(session)
  const blocked = session.status === 'blocked'
  const at = where(placed, sharedName)
  const title = session.title ?? topic ?? session.name
  const edge = peeking
    ? 'border-accent'
    : blocked
      ? 'border-ask-line hover:border-warn'
      : 'border-line hover:border-line-strong'
  return (
    <article
      className={`relative flex flex-none flex-col gap-1 rounded-[9px] border px-[11px] pt-[9px] pb-2.5 transition-colors duration-75 ${blocked ? 'bg-ask' : 'bg-raised'} ${edge}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <AgentMark mark={markOf(session)} />
        <span className="min-w-0 truncate" title={at.title}>
          {at.name}
          {at.machine ? <span className="text-faint"> · {at.machine}</span> : null}
        </span>
        <span className="ml-auto flex">
          <SessionTime status={session.status} at={session.statusSince} now={now} />
        </span>
      </div>
      <button
        type="button"
        onClick={() => onOpen(false)}
        className="line-clamp-2 w-full cursor-pointer border-0 bg-transparent p-0 text-left leading-[1.35] font-semibold text-text outline-none after:absolute after:inset-0 after:rounded-[8px] focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        {title}
      </button>
      {tool ? (
        <p className="m-0 truncate font-mono text-[11.5px] text-muted">{toolLine(tool)}</p>
      ) : blocked ? (
        <p className="m-0 text-[12.5px] text-muted">{t('active.waits')}</p>
      ) : asked && asked !== title ? (
        <p className="m-0 line-clamp-2 text-[12.5px] text-muted">
          <span className="mr-1 font-semibold">›</span>
          {asked}
        </p>
      ) : null}
      {blocked ? (
        <button
          type="button"
          onClick={() => onOpen(true)}
          className="relative z-[1] mt-[3px] inline-flex h-6 cursor-pointer items-center gap-[5px] self-start rounded-md border border-ask-line bg-raised px-2 text-xs text-text hover:border-warn focus-visible:outline-2 focus-visible:outline-accent"
        >
          <SquareTerminal size={13} />
          {t('active.answer')}
        </button>
      ) : null}
    </article>
  )
}

export function StandingRow({ placed, now, peeking, sharedName, onOpen }: Props) {
  const { session } = placed
  const { topic } = useCardNote(session)
  const at = where(placed, sharedName)
  return (
    <button
      type="button"
      onClick={() => onOpen(false)}
      className={`flex h-7 w-full flex-none cursor-pointer items-center gap-2 rounded-md border-0 px-2 text-left text-[12.5px] text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${peeking ? 'bg-selected' : 'bg-transparent'}`}
    >
      <AgentMark mark={markOf(session)} />
      <span className="min-w-0 flex-1 truncate">{session.title ?? topic ?? session.name}</span>
      <span className="max-w-28 flex-none truncate text-[11.5px] text-faint" title={at.title}>
        {at.machine ? `${at.name} · ${at.machine}` : at.name}
      </span>
      <SessionTime status={session.status} at={session.statusSince} now={now} />
    </button>
  )
}
