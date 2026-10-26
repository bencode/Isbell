// An agent that finished and was not looked at since: the end of what it said, a follow-up, and ✓
// to mark it read.

import { Check } from 'lucide-react'
import { Button } from '../../../components/button'
import { errorText, useI18n } from '../../../core/i18n'
import { markSeen } from '../../../core/prefs'
import { type Placed, paneKey } from '../../../model/projects'
import type { Reading } from '../../../model/screen/types'
import { Composer } from '../../pane/composer'
import { Reply } from '../../pane/reply'
import { useReading } from '../../pane/use-reading'
import { Card, CardHead, SentNote, useSent } from './card'

export function FinishedCard({ placed, now }: { placed: Placed; now: number }) {
  const t = useI18n()
  const { session } = placed
  const { mid, paneId } = session
  const { reading, text, error, reread } = useReading(mid, paneId, session)
  const { sent, markSent, unsend } = useSent(session)

  return (
    <Card sent={!!sent}>
      <CardHead placed={placed} now={now} />
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
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Composer mid={mid} paneId={paneId} onSent={markSent} />
            </div>
            <Button
              size="icon"
              onClick={() => markSeen(paneKey(mid, paneId), session.statusSince)}
              aria-label={t('card.markRead')}
              title={t('card.markRead')}
              className="mt-1 text-ok"
            >
              <Check size={16} />
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

/** The end of what the agent said last, scrolled to its end with the rest above it. */
function LastReply({ reading, text }: { reading: Reading | null; text: string }) {
  const blocks = reading?.live?.reply.length ? reading.live.reply : reading?.turns.at(-1)?.reply
  if (!blocks?.length)
    return (
      <pre className="m-0 max-h-28 overflow-auto rounded-md bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap">
        {text.trimEnd().split('\n').slice(-6).join('\n')}
      </pre>
    )
  // A reversed column starts scrolled to its end.
  return (
    <div className="flex max-h-28 flex-col-reverse overflow-auto text-[13px]">
      <div className="flex flex-col gap-2">
        <Reply blocks={blocks} />
      </div>
    </div>
  )
}
