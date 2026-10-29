// An agent on a phone's board that is not waiting on you, working or standing by, in a row a finger
// can hit: its name, where, one line of what it is doing or said last, and since when. The row opens
// its session; a working one can be stopped from it.

import { Square } from 'lucide-react'
import { Link } from 'react-router'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed, Session } from '../../../model/projects'
import { sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'
import { useAnswer } from '../../pane/asking'
import { useReading } from '../../pane/use-reading'
import { lastWords, workingTail } from './card'

export function AgentRow({
  placed: { session, project },
  now,
  scoped,
  running = false,
}: {
  placed: Placed
  now: number
  /** All of one project's, so the row need not say which. */
  scoped: boolean
  running?: boolean
}) {
  const t = useI18n()
  // Esc interrupts the turn going on, in the agents Isbell runs; the status says when it took.
  const stop = useAnswer(session.mid, session.paneId, () => undefined)
  const unknown = session.status === 'unknown'
  return (
    <div
      className={`flex min-h-[52px] items-center rounded-lg border border-line bg-raised ${project.online ? '' : 'opacity-60'}`}
    >
      <Link
        to={sessionHref(session.mid, session.paneId)}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-lg py-2 pr-2 pl-3 text-text no-underline active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {running ? (
          <span className="size-2 flex-none animate-pulse rounded-full bg-accent" />
        ) : unknown ? (
          <span
            title={t('status.unknown')}
            className="w-2 flex-none text-center text-[11px] font-bold text-faint"
          >
            ?
          </span>
        ) : (
          <span className="size-2 flex-none rounded-full border-[1.5px] border-faint" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5 text-[13.5px]">
            <b className="truncate font-semibold">{session.name}</b>
            {scoped ? null : (
              <span className="min-w-0 truncate text-xs text-faint">
                {project.name} · {project.machine}
              </span>
            )}
          </span>
          {/* An offline machine's screens cannot be read. */}
          {project.online ? <Line session={session} running={running} /> : null}
          {stop.error ? <span className="truncate text-xs text-danger">{stop.error}</span> : null}
        </span>
        <span className="flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
      </Link>
      {running ? (
        <button
          type="button"
          onClick={() => void stop.press('esc')}
          disabled={stop.busy}
          aria-label={t('card.stop')}
          title={t('card.stopHint')}
          className="mr-1.5 inline-flex size-10 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-faint active:bg-raised-2 active:text-danger disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Square size={12} fill="currentColor" />
        </button>
      ) : null}
    </div>
  )
}

/** One line of what it is doing, or else of what it said last. A working agent is read again 2s
 * after each read; a settled one, once. */
function Line({ session, running }: { session: Session; running: boolean }) {
  const t = useI18n()
  const { reading, text, error } = useReading(session.mid, session.paneId, session)
  if (error) return <span className="truncate text-xs text-danger">{errorText(t, error)}</span>
  const line = running
    ? (workingTail(reading, text, 1)[0] ?? session.title)
    : lastWords(reading)?.split('\n')[0]
  return line ? (
    <span className={`truncate text-muted ${running ? 'font-mono text-[11.5px]' : 'text-[12.5px]'}`}>
      {line}
    </span>
  ) : null
}
