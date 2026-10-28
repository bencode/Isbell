// An agent that finished and was not looked at since: the end of what it said, all of it when asked,
// a follow-up, and ✓ to mark it read.

import { Check } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { errorText, useI18n } from '../../../core/i18n'
import { markSeen } from '../../../core/prefs'
import { type Placed, paneKey } from '../../../model/projects'
import type { Reading } from '../../../model/screen/types'
import { Composer } from '../../pane/composer'
import { Reply } from '../../pane/reply'
import { useReading } from '../../pane/use-reading'
import { Card, CardHead, HEAD_BUTTON, lastReply, SentNote, useSent } from './card'

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
            className={`${HEAD_BUTTON} hover:text-ok`}
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
            <LastReply reading={reading} text={text} />
          )}
          {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
          <Composer mid={mid} paneId={paneId} onSent={markSent} compact />
        </>
      )}
    </Card>
  )
}

/** The lines of a screen not read as turns that the card shows until asked for all. */
const TAIL = 6

/** The end of what the agent said last, scrolled to its end with the rest above it; or all of it,
 * when it runs longer than the card shows and is asked for. */
function LastReply({ reading, text }: { reading: Reading | null; text: string }) {
  const t = useI18n()
  const blocks = lastReply(reading)
  const lines = text.trimEnd().split('\n')
  const box = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [all, setAll] = useState(false)
  // Whether it runs past the card, measured once laid out at the card's height.
  useLayoutEffect(() => {
    const el = box.current
    if (el && !all) setLong(el.scrollHeight > el.clientHeight + 1 || (!blocks?.length && lines.length > TAIL))
  })
  const height = all ? '' : 'max-h-28'
  return (
    <div className="flex flex-col items-start gap-1">
      {blocks?.length ? (
        // A reversed column starts scrolled to its end.
        <div ref={box} className={`flex w-full flex-col-reverse overflow-auto text-[13px] ${height}`}>
          <div className="flex flex-col gap-2">
            <Reply blocks={blocks} />
          </div>
        </div>
      ) : (
        <div ref={box} className={`w-full overflow-auto ${height}`}>
          <pre className="m-0 rounded-md bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap">
            {(all ? lines : lines.slice(-TAIL)).join('\n')}
          </pre>
        </div>
      )}
      {long || all ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs text-faint hover:text-accent"
        >
          {t(all ? 'card.less' : 'card.all')}
        </button>
      ) : null}
    </div>
  )
}
