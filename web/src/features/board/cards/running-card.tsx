// An agent at work, mostly to watch: what it was asked and what it is doing, as its hook tells
// herdr, else the last lines of its screen, lit when they change and greyed once they have not for
// a while; and a way to stop it when it goes astray.

import { Square } from 'lucide-react'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import { useAnswer } from '../../pane/asking'
import { useAgentNote } from '../../pane/use-agent-note'
import { useReading } from '../../pane/use-reading'
import { CardHead, headButton, toolText, workingTail } from './card'

const TAIL = 3

export function RunningCard({ placed, now, scoped }: { placed: Placed; now: number; scoped: boolean }) {
  const t = useI18n()
  const { session } = placed
  // A working agent is read again 2s after each read.
  const { reading, text, error } = useReading(session.mid, session.paneId, session)
  const note = useAgentNote(session)
  // Esc interrupts the turn going on, in the agents Isbell runs; the status says when it took.
  const stop = useAnswer(session.mid, session.paneId, () => undefined)
  const lines = workingTail(reading, text, TAIL)
  const tail = lines.join('\n')
  const doing = note?.doing ? toolText(t, note.doing) : t('card.thinking')
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5">
      <CardHead
        placed={placed}
        now={now}
        scoped={scoped}
        note={note}
        lead={<span className="size-2 flex-none animate-pulse rounded-full bg-accent" />}
        actions={
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
        }
      />
      {note?.asked || note?.doing ? (
        <>
          {note.asked ? (
            <p className="m-0 truncate text-[12.5px] text-faint" title={note.asked}>
              › {note.asked}
            </p>
          ) : null}
          {/* Keyed by what it does, so a change restarts the animation. */}
          <span key={doing} className="flex animate-tail items-center gap-1.5 rounded px-1 text-[13px]">
            <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent" />
            <span className="min-w-0 truncate" title={doing}>
              {doing}
            </span>
          </span>
        </>
      ) : tail ? (
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
