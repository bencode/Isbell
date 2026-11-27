// An agent in the right column, one way whatever it does: its status dot, its role and title, and
// under them what it waits on or uses, or else its project and agent. One that asks for you stands
// out and can be answered in its terminal; a lead folds its team. Opening it looks at it.

import { ChevronDown, ChevronRight, Share2, SquareTerminal } from 'lucide-react'
import { Tip } from '../../components/tip'
import { useI18n } from '../../core/i18n'
import { AGENT_NAMES, STATUS_DOTS } from '../../features/session/session-row'
import { SessionTime } from '../../features/session/session-time'
import { useCardNote } from '../../features/session/use-agent-note'
import { toolLine } from '../../model/agent-note'
import type { Placed } from '../../model/projects'

/** The team a lead leads: how many are in it, whether they show, and whether one hidden asks. */
export type Team = { count: number; open: boolean; asking: boolean; onToggle: () => void }

type Props = {
  placed: Placed
  /** The role it took. */
  role?: string | undefined
  now: number
  /** It is the one looked at. */
  peeking: boolean
  team?: Team | undefined
  /** The notes of the shares it is in. */
  sharedTo?: string[] | undefined
  /** Opens it in its terminal, or else as it was last viewed. */
  onOpen: (terminal?: boolean) => void
}

/** Its project and agent; its machine is the list's heading, and named again on pointing. */
function whereOf({ project, session }: Placed) {
  const name = project.configured ? project.name : project.display
  const agent = AGENT_NAMES[session.kind ?? ''] ?? session.kind
  return { text: [name, agent].filter(Boolean).join(' · '), title: `${name} · ${project.machine}` }
}

export function AgentRow({ placed, role, now, peeking, team, sharedTo, onOpen }: Props) {
  const t = useI18n()
  const { session } = placed
  const { tool, topic } = useCardNote(session)
  const blocked = session.status === 'blocked'
  // A finished one looked at stands by, as far as its dot goes.
  const seen = session.status === 'done' && !session.unread
  const dot = (!seen && session.status && STATUS_DOTS[session.status]) || 'bg-line-strong'
  const where = whereOf(placed)
  const under = tool ? toolLine(tool) : blocked ? t('active.waits') : undefined
  return (
    <div
      className={`relative flex flex-none gap-2 rounded-[7px] px-2 py-[5px] transition-colors duration-75 ${blocked ? 'bg-ask shadow-[inset_0_0_0_1px_var(--ask-line)]' : peeking ? 'bg-selected' : 'hover:bg-hover'} ${peeking ? "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:content-['']" : ''}`}
    >
      <span aria-hidden className={`relative mt-[7px] size-1.5 flex-none rounded-full ${dot}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen()}
            className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] leading-5 text-text outline-none after:absolute after:inset-0 after:rounded-[7px] focus-visible:after:outline-2 focus-visible:after:outline-accent"
          >
            {role ? <span className="mr-1.5 font-semibold">{role}</span> : null}
            {session.title ?? topic ?? session.name}
          </button>
          {sharedTo?.length ? (
            <Tip label={t('agentShare.to', { names: sharedTo.join(t('agentShare.and')) })} side="top">
              <span className="relative z-[1] inline-flex flex-none text-accent">
                <Share2 size={11} />
              </span>
            </Tip>
          ) : null}
        </div>
        {under ? (
          <span
            className={`truncate text-[11.5px] leading-4 text-muted ${tool ? 'font-mono text-[11px]' : ''}`}
          >
            {under}
          </span>
        ) : (
          <span className="truncate text-[11.5px] leading-4 text-faint" title={where.title}>
            {where.text}
          </span>
        )}
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <SessionTime status={session.status} at={session.statusSince} now={now} />
        {blocked ? (
          <button
            type="button"
            onClick={() => onOpen(true)}
            className="relative z-[1] inline-flex h-5 cursor-pointer items-center gap-1 rounded-[5px] border border-ask-line bg-raised px-1.5 text-[11px] text-text hover:border-warn focus-visible:outline-2 focus-visible:outline-accent"
          >
            <SquareTerminal size={11} />
            {t('active.answer')}
          </button>
        ) : null}
        {team ? (
          <button
            type="button"
            aria-expanded={team.open}
            aria-label={t('active.team', { n: team.count })}
            title={t('active.team', { n: team.count })}
            onClick={team.onToggle}
            className={`relative z-[1] inline-flex h-[18px] cursor-pointer items-center gap-px rounded-[5px] border-0 bg-transparent px-1 font-mono text-[11px] hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${team.asking ? 'font-semibold text-warn' : 'text-faint'}`}
          >
            {team.open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {team.count}
          </button>
        ) : null}
      </div>
    </div>
  )
}
