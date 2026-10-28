// An agent at work, mostly to watch: the last lines of what it is doing, lit when they change and
// greyed once they have not for a while, and a way to stop it when it goes astray.

import { Square } from 'lucide-react'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import { tailLines } from '../../../model/screen'
import { since } from '../../../utils/time'
import { useAnswer } from '../../pane/asking'
import { useReading } from '../../pane/use-reading'
import { headButton, OpenButton } from './card'

const TAIL = 3

export function RunningCard({
  placed: { session, project },
  now,
  scoped,
}: {
  placed: Placed
  now: number
  scoped: boolean
}) {
  const t = useI18n()
  // A working agent is read again 2s after each read.
  const { reading, text, error } = useReading(session.mid, session.paneId, session)
  // Esc interrupts the turn going on, in the agents Isbell runs; the status says when it took.
  const stop = useAnswer(session.mid, session.paneId, () => undefined)
  // The turn going on, even while it has said nothing yet: the one before would pass for it.
  const blocks = reading?.live ? reading.live.reply : (reading?.turns.at(-1)?.reply ?? [])
  // A screen not read as turns shows as it is.
  const lines = reading
    ? tailLines(blocks, TAIL)
    : (text ?? '')
        .split('\n')
        .filter(l => l.trim())
        .slice(-TAIL)
  const tail = lines.join('\n')
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5">
      <span className="flex items-center gap-2 text-[13px]">
        <span className="size-2 flex-none animate-pulse rounded-full bg-accent" />
        <b className="truncate font-semibold">{session.name}</b>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
          {scoped ? null : project.name}
        </span>
        <span className="flex-none font-mono text-[11.5px] text-faint">
          {since(session.statusSince, now)}
        </span>
        <button
          type="button"
          onClick={() => void stop.press('esc')}
          disabled={stop.busy}
          aria-label={t('card.stop')}
          title={t('card.stopHint')}
          className={`${headButton()} hover:text-danger`}
        >
          <Square size={11} fill="currentColor" />
        </button>
        <OpenButton session={session} />
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
      {stop.error ? <span className="truncate text-[12px] text-danger">{stop.error}</span> : null}
    </div>
  )
}
