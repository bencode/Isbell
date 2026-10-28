// An agent waiting for an answer, answered on the card: its question and options, or, when the
// question could not be read, the end of its screen with keys and a reply.

import { useState } from 'react'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import type { Question } from '../../../model/screen/types'
import { terminalHref } from '../../../utils/hrefs'
import { AnswerElsewhere, Options, ScreenKeys, useAnswer } from '../../pane/asking'
import { Composer } from '../../pane/composer'
import { useReading } from '../../pane/use-reading'
import { Card, CardHead, SentNote, useSent } from './card'

/** The detail lines a card shows before "Show all". */
const DETAIL = 3

export function AskingCard({ placed, now, scoped }: { placed: Placed; now: number; scoped: boolean }) {
  const t = useI18n()
  const { session } = placed
  const { mid, paneId } = session
  // A blocked agent is read once; the status changing is what reads it again.
  const { reading, text, error, reread } = useReading(mid, paneId, session)
  const { sent, markSent, unsend } = useSent(session)
  const question = reading?.question
  // The option's words say more than its key.
  const answered = (key: string) => markSent(question?.options.find(o => o.key === key)?.label ?? key)
  const answer = useAnswer(mid, paneId, answered)
  const press = (key: string) => void answer.press(key)
  const failure = answer.error ?? (error ? errorText(t, error) : undefined)

  return (
    <Card ask sent={!!sent}>
      <CardHead placed={placed} now={now} scoped={scoped} />
      {sent ? (
        <SentNote
          what={sent}
          onAgain={() => {
            unsend()
            reread()
          }}
        />
      ) : text === null ? (
        <p className="m-0 text-[13px] text-muted">{t('session.reading')}</p>
      ) : question ? (
        <>
          <p className="m-0 text-[13.5px] break-words">{question.text}</p>
          <Detail question={question} />
          <Options question={question} busy={answer.busy} onPick={press} />
          <AnswerElsewhere terminal={terminalHref(mid, paneId)} />
        </>
      ) : (
        <>
          <ScreenKeys screen={text} lines={6} busy={answer.busy} onPress={press} />
          <Composer mid={mid} paneId={paneId} onSent={markSent} compact />
        </>
      )}
      {failure ? <p className="m-0 text-[13px] text-danger">{failure}</p> : null}
    </Card>
  )
}

/** What the agent shows around its question, such as the edit it wants to make; long ones fold. */
function Detail({ question: { detail } }: { question: Question }) {
  const t = useI18n()
  const [all, setAll] = useState(false)
  if (!detail.length) return null
  const folded = !all && detail.length > DETAIL
  return (
    <>
      <pre className="m-0 overflow-x-auto rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[11.5px] leading-normal whitespace-pre-wrap">
        {(folded ? detail.slice(0, DETAIL) : detail).join('\n')}
      </pre>
      {folded ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="-mt-1 cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-accent hover:underline"
        >
          {t('card.showAll', { n: detail.length })}
        </button>
      ) : null}
    </>
  )
}
