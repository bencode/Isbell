// What every card on the board shares: its frame, its head, and the note it keeps once answered
// until the agent moves on.

import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { useI18n } from '../../../core/i18n'
import type { Placed, Session } from '../../../model/projects'
import type { Block, Reading } from '../../../model/screen/types'
import { sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'

/** What the agent said last: the turn still going, or else the last one ended. */
export const lastReply = (reading: Reading | null): Block[] | undefined =>
  reading?.live?.reply.length ? reading.live.reply : reading?.turns.at(-1)?.reply

/** `sent` fades the card while what was sent takes effect. */
export function Card({ ask, sent, children }: { ask?: boolean; sent?: boolean; children: ReactNode }) {
  const frame = sent
    ? 'border-dashed border-line-strong opacity-60'
    : `index-card ${ask ? 'border-ask-line' : 'border-line'}`
  return (
    <div className={`flex flex-col gap-2.5 rounded-[10px] border bg-raised px-3.5 py-3 ${frame}`}>
      {children}
    </div>
  )
}

/** The agent's name, where it runs, how long it has been so, and the way to its page. */
export function CardHead({ placed: { session, project }, now }: { placed: Placed; now: number }) {
  const t = useI18n()
  return (
    <div className="flex items-baseline gap-2">
      <b className="truncate font-semibold">{session.name}</b>
      <span className="min-w-0 flex-1 truncate text-xs text-faint">
        {project.name} · {project.machine}
      </span>
      <span className="flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
      <Link
        to={sessionHref(session.mid, session.paneId)}
        aria-label={t('card.open')}
        title={t('card.open')}
        className="flex-none text-[13px] text-faint no-underline hover:text-accent"
      >
        ↗
      </Link>
    </div>
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
