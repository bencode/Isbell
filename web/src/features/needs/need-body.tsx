// An open row of Needs you: what the agent asks, or how it ended, and a way to answer it there.

import { Link } from 'react-router'
import { errorText, useI18n } from '../../core/i18n'
import type { Session } from '../../model/projects'
import type { Reading } from '../../model/screen/types'
import { sessionHref, terminalHref } from '../../utils/hrefs'
import { Asking } from '../pane/asking'
import { Composer } from '../pane/composer'
import { Reply } from '../pane/reply'
import { useReading } from '../pane/use-reading'

const LINK = 'text-accent no-underline hover:underline'

/** `next` names the row that opens once this one leaves; undefined when it is the last. */
export function NeedBody({ session, next }: { session: Session; next: string | undefined }) {
  const t = useI18n()
  const { mid, paneId } = session
  // Only the open row reads, and an agent that is not working is read once.
  const { reading, text, error, reread } = useReading(mid, paneId, session)
  const terminal = terminalHref(mid, paneId)
  const asking = session.status === 'blocked'
  // Typing under a question that was read would land in the agent's menu; as on the session page.
  const reply = text !== null && !(asking && reading?.question)
  return (
    <div
      className={`flex flex-col gap-3 border-l-[3px] px-4 pt-3.5 pb-4 ${asking ? 'border-warn' : 'border-ok'}`}
    >
      {text === null ? (
        <p className="m-0 text-[13px] text-muted">{t('session.reading')}</p>
      ) : asking ? (
        <Asking
          mid={mid}
          paneId={paneId}
          name={session.name}
          question={reading?.question}
          screen={text}
          terminal={terminal}
          onAnswered={reread}
        />
      ) : (
        <LastReply reading={reading} text={text} />
      )}
      {error ? <p className="m-0 text-[13px] text-danger">{errorText(t, error)}</p> : null}
      {reply ? <Composer mid={mid} paneId={paneId} onSent={reread} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <Link to={sessionHref(mid, paneId)} className={LINK}>
          {t('needs.open')} ↗
        </Link>
        <Link to={terminal} className={LINK}>
          {t('session.terminal')}
        </Link>
        {asking ? null : <span>{t('needs.readOnLeave')}</span>}
        <span className="ml-auto text-faint">{next ? t('needs.next', { name: next }) : t('needs.last')}</span>
      </div>
    </div>
  )
}

/** The end of what the agent said last; scrolled to its end, with the rest above it. */
function LastReply({ reading, text }: { reading: Reading | null; text: string }) {
  const blocks = reading?.live?.reply.length ? reading.live.reply : reading?.turns.at(-1)?.reply
  if (!blocks?.length)
    return (
      <pre className="m-0 overflow-auto rounded-md bg-bg px-3 py-2.5 font-mono text-[12.5px] leading-snug whitespace-pre-wrap">
        {text.trimEnd().split('\n').slice(-8).join('\n')}
      </pre>
    )
  // A reversed column starts scrolled to its end.
  return (
    <div className="flex max-h-48 flex-col-reverse overflow-auto text-[13.5px]">
      <div className="flex flex-col gap-2.5">
        <Reply blocks={blocks} />
      </div>
    </div>
  )
}
