// An agent at work, to watch rather than act on; the card opens its page.

import { Link } from 'react-router'
import type { Placed } from '../../../model/projects'
import { sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'

export function RunningCard({ placed: { session, project }, now }: { placed: Placed; now: number }) {
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
      {session.title ? (
        <span className="truncate font-mono text-[11.5px] text-muted">{session.title}</span>
      ) : null}
    </Link>
  )
}
