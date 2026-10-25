// A session's screen as turns: one card per turn, headed by what was asked, then the reply with
// its tool calls folded to a line each; the turn still going ends with what the agent is doing.

import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import type { Block, Reading, Turn } from '../../model/screen/types'
import { type AgentStatus, settled } from '../../model/state'
import { keyed } from '../../utils/keyed'
import { since, useNow } from '../../utils/time'
import { CopyReply, Reply } from './reply'

export function Turns({
  reading,
  status,
  statusSince,
  terminal,
  onEarlier,
  paging,
  more,
}: {
  reading: Reading
  status: AgentStatus
  statusSince: number
  /** Where earlier turns can still be seen. */
  terminal: string
  /** Reads earlier turns; absent while they cannot be read. */
  onEarlier: (() => void) | undefined
  paging: boolean
  /** Whether earlier turns may remain. */
  more: boolean
}) {
  const t = useI18n()
  const { footer } = reading
  // What was still going when the agent stopped is past; a read after the stop replaces it.
  const live = settled(status) ? undefined : reading.live
  const count = reading.turns.length + (live ? 1 : 0)
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {footer?.task ? <span className="text-[15px] font-semibold">{footer.task}</span> : null}
        {footer?.model ? (
          <span className="rounded border border-line bg-raised px-1.5 font-mono text-[11.5px] text-muted">
            {footer.model}
          </span>
        ) : null}
        <span className="text-xs text-faint">
          {count === 1 ? t('chat.oneTurn') : t('chat.turns', { n: count })}
        </span>
      </div>
      <Scope start={reading.start} terminal={terminal} onEarlier={onEarlier} paging={paging} more={more} />
      {keyed(reading.turns, turn => [turn.prompt, turn.at, turn.took].join('\n')).map(([key, turn]) => (
        <TurnCard key={key} turn={turn} />
      ))}
      {live ? (
        <LiveTurn prompt={live.prompt} reply={live.reply} status={status} statusSince={statusSince} />
      ) : null}
    </>
  )
}

/** Where the turns shown begin: the start of the session, or a way to what came before. */
function Scope({
  start,
  terminal,
  onEarlier,
  paging,
  more,
}: {
  start: boolean
  terminal: string
  onEarlier: (() => void) | undefined
  paging: boolean
  more: boolean
}) {
  const t = useI18n()
  return (
    <div className="flex items-center gap-2.5 text-xs text-faint before:flex-1 before:border-t before:border-dashed before:border-line-strong after:flex-1 after:border-t after:border-dashed after:border-line-strong">
      {start ? (
        t('chat.start')
      ) : onEarlier ? (
        <button
          type="button"
          onClick={onEarlier}
          disabled={paging}
          className="h-[26px] cursor-pointer rounded-full border border-line bg-raised px-3 text-xs font-medium text-accent enabled:hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-faint"
        >
          {paging ? t('chat.readingEarlier') : t('chat.showEarlier')}
        </button>
      ) : more ? (
        <span>
          {t('chat.earlier')} ·{' '}
          <Link to={terminal} className="text-accent no-underline hover:underline">
            {t('session.terminal')}
          </Link>
        </span>
      ) : (
        t('chat.noEarlier')
      )}
    </div>
  )
}

const CARD = 'rounded-md border bg-raised'

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <article className={`group ${CARD} index-card border-line`}>
      <Asked prompt={turn.prompt} when={[turn.at, turn.took].filter(Boolean).join(' · ')} />
      <div className="relative flex flex-col gap-2.5 px-4 pt-3 pb-3.5">
        <Reply blocks={turn.reply} />
        <CopyReply blocks={turn.reply} />
      </div>
    </article>
  )
}

function LiveTurn({
  prompt,
  reply,
  status,
  statusSince,
}: {
  prompt: string | undefined
  reply: Block[]
  status: AgentStatus
  statusSince: number
}) {
  const t = useI18n()
  const now = useNow(1000)
  const asking = status === 'blocked'
  return (
    <article
      className={`${CARD} ${asking ? 'border-ask-line shadow-[2px_2px_0_var(--ask-line)]' : 'border-accent/45 shadow-[2px_2px_0_var(--line)]'}`}
    >
      {prompt === undefined ? null : <Asked prompt={prompt} when="" />}
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3.5">
        <Reply blocks={reply} />
        {asking ? (
          <p className="m-0 flex items-center gap-2 text-[12.5px] font-medium text-warn">
            <span className="size-[7px] rounded-full bg-warn" />
            {t('chat.waiting')}
          </p>
        ) : (
          <p className="m-0 flex items-center gap-2 text-[12.5px] font-medium text-accent">
            <span className="size-[7px] animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            {t('chat.working')}
            <span className="font-mono text-[11.5px] font-normal text-faint">{since(statusSince, now)}</span>
          </p>
        )}
      </div>
    </article>
  )
}

function Asked({ prompt, when }: { prompt: string; when: string }) {
  return (
    <header className="flex items-baseline gap-2.5 border-b border-line px-4 pt-3 pb-2.5">
      <span aria-hidden="true" className="flex-none font-mono font-medium text-accent">
        ›
      </span>
      <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold break-words whitespace-pre-wrap">{prompt}</h3>
      {when ? (
        <span className="flex-none font-mono text-[11.5px] whitespace-nowrap text-faint">{when}</span>
      ) : null}
    </header>
  )
}
