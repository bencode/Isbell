// What every card on the board shares: its frame, its head, and the note it keeps once answered
// until the agent moves on.

import { MessageSquareText } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../../core/i18n'
import type { Placed, Session } from '../../../model/projects'
import { tailLines } from '../../../model/screen'
import type { Block, Reading } from '../../../model/screen/types'
import { boardHref, peekHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'

/** The turn still going, or else the last one ended. */
export const lastTurn = (reading: Reading | null): { prompt?: string; reply: Block[] } | undefined =>
  reading?.live?.reply.length ? reading.live : reading?.turns.at(-1)

/** What the agent said last: the turn still going, or else the last one ended. */
export const lastReply = (reading: Reading | null): Block[] | undefined => lastTurn(reading)?.reply

/** The last paragraph of what the agent said last. */
export const lastWords = (reading: Reading | null): string | undefined =>
  lastReply(reading)
    ?.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .at(-1)?.text

/** The last `n` lines of what a working agent is doing: of the turn going on, even while it has
 * said nothing yet (the one before would pass for it), or of its screen when not read as turns. */
export const workingTail = (reading: Reading | null, text: string | null, n: number): string[] =>
  reading
    ? tailLines(reading.live ? reading.live.reply : (reading.turns.at(-1)?.reply ?? []), n)
    : (text ?? '')
        .split('\n')
        .filter(l => l.trim())
        .slice(-n)

/** `sent` fades the card while what was sent takes effect. */
export function Card({ ask, sent, children }: { ask?: boolean; sent?: boolean; children: ReactNode }) {
  const frame = sent
    ? 'border-dashed border-line-strong opacity-60'
    : `index-card ${ask ? 'border-ask-line' : 'border-line'}`
  return (
    <div className={`flex flex-col gap-2 rounded-[10px] border bg-raised px-3 py-2.5 ${frame}`}>
      {children}
    </div>
  )
}

/** The agent's name, where it runs unless the board is all one project's, how long it has been so,
 * what else the card does in a word (`actions`), and the button that opens it. */
export function CardHead({
  placed: { session, project },
  now,
  scoped,
  actions,
}: {
  placed: Placed
  now: number
  scoped: boolean
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <b className="truncate text-[13.5px] font-semibold">{session.name}</b>
      <span className="min-w-0 flex-1 truncate text-xs text-faint">
        {scoped ? null : `${project.name} · ${project.machine}`}
      </span>
      <span className="mr-0.5 flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
      {actions}
      <OpenButton session={session} />
    </div>
  )
}

/** A small icon button for a card's head, where words would crowd it; `on` while what it opens is
 * open. Its colours are one or the other, since classes setting the same one do not override. */
export const headButton = (on = false) =>
  `inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 no-underline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 ${on ? 'bg-accent-soft text-accent' : 'bg-transparent text-faint hover:bg-raised-2'}`

/** The one way into a session from its card, beside the board: the card itself is for acting on it
 * in place. On the session open beside the board, it closes it. */
export function OpenButton({ session }: { session: Session }) {
  const t = useI18n()
  const { key, mid, pane } = useParams()
  const open = mid === session.mid && pane === session.paneId
  const label = t(open ? 'card.close' : 'card.open')
  return (
    <Link
      to={open ? boardHref(key) : peekHref(key, session.mid, session.paneId)}
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={`${headButton(open)} ${open ? '' : 'hover:text-accent'}`}
    >
      <MessageSquareText size={14} />
    </Link>
  )
}

/** What was sent, kept while the session is still as it was then; any change of status ends it. */
export function useSent(session: Session) {
  const [sent, setSent] = useState<{ what: string; at: number }>()
  return {
    sent: sent?.at === session.statusSince ? sent.what : undefined,
    markSent: (what: string) => setSent({ what, at: session.statusSince }),
    unsend: () => setSent(undefined),
  }
}

/** What was sent; when it did not take, `onAgain` brings the card back to answer. */
export function SentNote({ what, onAgain }: { what: string; onAgain: () => void }) {
  const t = useI18n()
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
      {t('card.sent', { what })}
      <button
        type="button"
        onClick={onAgain}
        className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline"
      >
        {t('card.again')}
      </button>
    </p>
  )
}
