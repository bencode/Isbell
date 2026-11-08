// A session on the phone's home page: a card for one that asks, has finished or works, a line for
// one standing by. The whole card opens it; one that asks can go straight to its terminal.

import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import { StatusDot } from '../../components/status-dot'
import { useI18n } from '../../core/i18n'
import { useCardNote } from '../../features/session/use-agent-note'
import { toolLine } from '../../model/agent-note'
import { type Placed, placedTitle, placedWhere } from '../../model/projects'
import { sessionHref } from '../../utils/hrefs'
import { since } from '../../utils/time'

type Props = { placed: Placed; now: number }

export function PhoneCard({ placed, now }: Props) {
  const t = useI18n()
  const { session } = placed
  const { tool, asked } = useCardNote(session)
  const blocked = session.status === 'blocked'
  return (
    <article
      className={`relative flex flex-col gap-1 rounded-[11px] border px-[13px] pt-[11px] pb-3 active:border-line-strong ${blocked ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
    >
      <div className="flex min-w-0 items-center gap-[7px] text-xs text-muted">
        <StatusDot status={session.status} />
        <span className="min-w-0 truncate">{placedWhere(placed)}</span>
        <span className="ml-auto flex-none font-mono text-[11px] text-faint">
          {since(session.statusSince, now)}
        </span>
      </div>
      <Link
        to={sessionHref(session.mid, session.paneId)}
        className="line-clamp-2 text-[15px] leading-[1.35] font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']"
      >
        {placedTitle(placed)}
      </Link>
      {tool ? (
        <p className="m-0 truncate font-mono text-xs text-muted">{toolLine(tool)}</p>
      ) : blocked ? (
        <p className="m-0 text-[13px] text-muted">{t('active.waits')}</p>
      ) : asked ? (
        <p className="m-0 line-clamp-2 text-[13px] text-muted">{asked}</p>
      ) : null}
      {blocked ? (
        <Link
          to={sessionHref(session.mid, session.paneId, true)}
          className="relative z-[1] mt-[5px] flex h-11 items-center justify-center gap-[7px] rounded-[9px] border border-ask-line bg-raised text-[14.5px] font-semibold text-text no-underline active:bg-hover"
        >
          <SquareTerminal size={16} />
          {t('active.answer')}
        </Link>
      ) : null}
    </article>
  )
}

export function PhoneRow({ placed, now }: Props) {
  const { session } = placed
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className="flex h-11 items-center gap-2.5 rounded-lg px-2 text-sm text-muted no-underline active:bg-hover"
    >
      <StatusDot status={session.status} />
      <span className="min-w-0 flex-1 truncate">{placedTitle(placed)}</span>
      <span className="flex-none font-mono text-[11px] text-faint">{since(session.statusSince, now)}</span>
    </Link>
  )
}
