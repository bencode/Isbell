import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '../../components/button'
import { StatusChip } from '../../components/chip'
import { useI18n } from '../../core/i18n'
import type { Session } from '../../model/projects'
import { sessionHref, terminalHref } from '../../utils/hrefs'
import { since } from '../../utils/time'

export function SessionCard({ session, now }: { session: Session; now: number }) {
  const t = useI18n()
  const asking = session.status === 'blocked'
  return (
    <div
      className={`relative flex min-h-28 flex-col gap-2 rounded-[10px] border p-3.5 text-text hover:border-line-strong ${asking ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
    >
      <span className="flex items-center gap-2">
        {/* The name is the card's link to the chat; its ::after covers the whole card. */}
        <Link
          to={sessionHref(session.mid, session.paneId)}
          className={`min-w-0 flex-1 truncate ${session.unread ? 'font-bold' : 'font-medium'} text-text no-underline outline-none after:absolute after:inset-0 after:rounded-[10px] focus-visible:after:outline-2 focus-visible:after:outline-accent`}
        >
          {session.name}
        </Link>
        <StatusChip status={session.status} label={t(`status.${session.status}`)} />
        <span className="flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
        <Link
          to={terminalHref(session.mid, session.paneId)}
          aria-label={t('session.terminal')}
          title={t('session.terminal')}
          className={buttonClass(
            'quiet',
            'relative z-10 -my-2 -mr-1.5 hover:bg-raised-2 hover:text-text',
            'icon',
          )}
        >
          <SquareTerminal size={15} />
        </Link>
      </span>
      {session.title ? <span className="line-clamp-2 text-[13.5px] text-muted">{session.title}</span> : null}
      <span className="mt-auto font-mono text-xs text-faint">{session.kind ?? session.paneId}</span>
    </div>
  )
}
