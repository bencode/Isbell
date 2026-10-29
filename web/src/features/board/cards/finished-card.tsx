// An agent that finished and was not looked at since: what it was asked and the end of what it
// said, a follow-up, and ✓ to mark it read.

import { Check } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { errorText, useI18n } from '../../../core/i18n'
import { markSeen } from '../../../core/prefs'
import { PathRoot } from '../../../core/tabs'
import { type Placed, paneKey } from '../../../model/projects'
import type { Reading } from '../../../model/screen/types'
import { Composer } from '../../pane/composer'
import { Reply } from '../../pane/reply'
import { useReading } from '../../pane/use-reading'
import { Card, CardHead, headButton, lastTurn, SentNote, useSent } from './card'

export function FinishedCard({ placed, now, scoped }: { placed: Placed; now: number; scoped: boolean }) {
  const t = useI18n()
  const { session } = placed
  const { mid, paneId } = session
  const { reading, text, error, reread } = useReading(mid, paneId, session)
  const { sent, markSent, unsend } = useSent(session)

  return (
    <Card sent={!!sent}>
      <CardHead
        placed={placed}
        now={now}
        scoped={scoped}
        actions={
          <button
            type="button"
            onClick={() => markSeen(paneKey(mid, paneId), session.statusSince)}
            aria-label={t('card.markRead')}
            title={t('card.markRead')}
            className={`${headButton()} hover:text-ok`}
          >
            <Check size={15} />
          </button>
        }
      />
      {sent ? (
        <SentNote
          what={sent}
          onAgain={() => {
            unsend()
            reread()
          }}
        />
      ) : (
        <>
          {text === null ? (
            <p className="m-0 text-[13px] text-muted">{t('session.reading')}</p>
          ) : (
            <PathRoot value={{ project: placed.project, cwd: session.cwd ?? placed.project.path }}>
              <LastReply reading={reading} text={text} />
            </PathRoot>
          )}
          {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
          <Composer mid={mid} paneId={paneId} onSent={markSent} compact />
        </>
      )}
    </Card>
  )
}

/** The lines of a screen not read as turns that the card shows. */
const TAIL = 6
/** The blocks of the last reply the card shows: where an answer comes to its point. */
const SHOWN = 2
/** Fades out the foot of a reply cut short. */
const FADE = '[mask-image:linear-gradient(to_bottom,black_70%,transparent)]'

/** What was asked and the end of the answer, cut short past the card's height; all of it reads in
 * the session. A screen not read as turns shows its last lines. */
function LastReply({ reading, text }: { reading: Reading | null; text: string }) {
  const turn = lastTurn(reading)
  const box = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  // Whether it runs past the card, measured once laid out at the card's height.
  useLayoutEffect(() => {
    const el = box.current
    if (el) setCut(el.scrollHeight > el.clientHeight + 1)
  })
  // A line too long to wrap, such as a rule drawn across the screen, is cut at the card's edge.
  if (!turn?.reply.length)
    return (
      <pre className="m-0 overflow-hidden rounded-md bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap">
        {text.trimEnd().split('\n').slice(-TAIL).join('\n')}
      </pre>
    )
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {turn.prompt ? (
        <p className="m-0 truncate text-[12.5px] text-faint" title={turn.prompt}>
          › {turn.prompt}
        </p>
      ) : null}
      <div
        ref={box}
        className={`flex max-h-28 flex-col gap-2 overflow-hidden text-[13px] ${cut ? FADE : ''}`}
      >
        <Reply blocks={turn.reply.slice(-SHOWN)} />
      </div>
    </div>
  )
}
