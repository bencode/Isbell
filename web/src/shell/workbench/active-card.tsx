// A session in the right column: a card for one that asks, has finished or works, a line for one
// standing by. The card opens it to look at; one that asks can be answered in its terminal.

import { SquareTerminal } from 'lucide-react'
import { StatusDot } from '../../components/status-dot'
import { useI18n } from '../../core/i18n'
import { useCardNote } from '../../features/session/use-agent-note'
import { toolLine } from '../../model/agent-note'
import { type Placed, placedTitle, placedWhere } from '../../model/projects'
import { since } from '../../utils/time'

type Props = {
  placed: Placed
  now: number
  /** It is the one looked at. */
  peeking: boolean
  onOpen: (terminal: boolean) => void
}

export function ActiveCard({ placed, now, peeking, onOpen }: Props) {
  const t = useI18n()
  const { session } = placed
  const { tool, asked } = useCardNote(session)
  const blocked = session.status === 'blocked'
  const edge = peeking
    ? 'border-accent'
    : blocked
      ? 'border-ask-line hover:border-warn'
      : 'border-line hover:border-line-strong'
  return (
    <article
      className={`relative flex flex-none flex-col gap-1 rounded-[9px] border px-[11px] pt-[9px] pb-2.5 transition-colors duration-75 ${blocked ? 'bg-ask' : 'bg-raised'} ${edge}`}
    >
      <div className="flex min-w-0 items-center gap-[7px] text-xs text-muted">
        <StatusDot status={session.status} />
        <span className="min-w-0 truncate">{placedWhere(placed)}</span>
        {peeking ? (
          <span className="ml-auto flex-none font-medium text-accent">{t('active.peeking')}</span>
        ) : (
          <span className="ml-auto flex-none font-mono text-[11px] text-faint">
            {since(session.statusSince, now)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(false)}
        className="line-clamp-2 w-full cursor-pointer border-0 bg-transparent p-0 text-left leading-[1.35] font-semibold text-text outline-none after:absolute after:inset-0 after:rounded-[8px] focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        {placedTitle(placed)}
      </button>
      {tool ? (
        <p className="m-0 truncate font-mono text-[11.5px] text-muted">{toolLine(tool)}</p>
      ) : blocked ? (
        <p className="m-0 text-[12.5px] text-muted">{t('active.waits')}</p>
      ) : asked ? (
        <p className="m-0 line-clamp-2 text-[12.5px] text-muted">{asked}</p>
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

export function StandingRow({ placed, now, peeking, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpen(false)}
      className={`flex h-7 w-full flex-none cursor-pointer items-center gap-2 rounded-md border-0 px-2 text-left text-[12.5px] text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${peeking ? 'bg-selected' : 'bg-transparent'}`}
    >
      <StatusDot status={placed.session.status} />
      <span className="min-w-0 flex-1 truncate">{placedTitle(placed)}</span>
      <span className="flex-none font-mono text-[11px] text-faint">
        {since(placed.session.statusSince, now)}
      </span>
    </button>
  )
}
