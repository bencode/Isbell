// An agent at work, to watch rather than act on: the last lines of what it is doing, lit when they
// change and greyed once they have not for a while. The card opens its page.

import { Link } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import { tailLines } from '../../../model/screen'
import { sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'
import { useReading } from '../../pane/use-reading'
import { lastReply } from './card'

const TAIL = 3

export function RunningCard({ placed: { session, project }, now }: { placed: Placed; now: number }) {
  const t = useI18n()
  // A working agent is read again 2s after each read.
  const { reading, text, error } = useReading(session.mid, session.paneId, session)
  const parsed = tailLines(lastReply(reading) ?? [], TAIL)
  const lines = parsed.length
    ? parsed
    : (text ?? '')
        .split('\n')
        .filter(l => l.trim())
        .slice(-TAIL)
  const tail = lines.join('\n')
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-text no-underline hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex items-center gap-2 text-[13px]">
        <span className="size-2 flex-none animate-pulse rounded-full bg-accent" />
        <b className="truncate font-semibold">{session.name}</b>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{project.name}</span>
        <span className="flex-none font-mono text-[11.5px] text-faint">
          {since(session.statusSince, now)}
        </span>
      </span>
      {tail ? (
        // Keyed by the lines, so a change restarts the animation.
        <span
          key={tail}
          className="flex animate-tail flex-col rounded px-1 font-mono text-[11.5px] leading-snug text-muted"
        >
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines may repeat, and their place is what tells them apart.
            <span key={i} className="truncate whitespace-pre">
              {line}
            </span>
          ))}
        </span>
      ) : session.title ? (
        <span className="truncate font-mono text-[11.5px] text-muted">{session.title}</span>
      ) : null}
      {error ? <span className="truncate text-[12px] text-danger">{errorText(t, error)}</span> : null}
    </Link>
  )
}
