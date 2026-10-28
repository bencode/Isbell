// What every card on the board shares: its frame, its head, and the note it keeps once answered
// until the agent moves on.

import { PanelRightOpen } from 'lucide-react'
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

/** The agent's name, where it runs unless the board is all one project's, how long it has been so,
 * and the button that opens it. */
export function CardHead({
  placed: { session, project },
  now,
  scoped,
}: {
  placed: Placed
  now: number
  scoped: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <b className="truncate font-semibold">{session.name}</b>
      <span className="min-w-0 flex-1 truncate text-xs text-faint">
        {scoped ? null : `${project.name} · ${project.machine}`}
      </span>
      <span className="flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
      <OpenButton session={session} />
    </div>
  )
}

/** The one way into a session from its card: the card itself is for acting on it in place. */
export function OpenButton({ session }: { session: Session }) {
  const t = useI18n()
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      aria-label={t('card.open')}
      title={t('card.open')}
      className="inline-flex size-6 flex-none items-center justify-center rounded-md text-faint no-underline hover:bg-raised-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <PanelRightOpen size={14} />
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
