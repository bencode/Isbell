// A session's screen as turns: one card per turn, headed by what was asked, then the reply with
// its tool calls folded to a line each; the turn still going ends with what the agent is doing.

import { type AgentStatus, type Block, type Reading, settled, type Turn } from '@isbell/core'
import { ChevronRight, Copy } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import { since, useNow } from '../../utils/time'

type Action = Extract<Block, { kind: 'action' }>

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

/** The reply in order, tool calls that follow one another sharing one box. */
function Reply({ blocks }: { blocks: Block[] }) {
  const runs = blocks.reduce<(Block | Action[])[]>((acc, b) => {
    const last = acc.at(-1)
    if (b.kind === 'action' && Array.isArray(last)) last.push(b)
    else acc.push(b.kind === 'action' ? [b] : b)
    return acc
  }, [])
  return keyed(runs, runKey).map(([key, run]) =>
    Array.isArray(run) ? (
      <div key={key} className="overflow-hidden rounded-[5px] border border-line">
        {keyed(run, a => `${a.verb} ${a.target}`).map(([k, a]) => (
          <ActionRow key={k} action={a} />
        ))}
      </div>
    ) : run.kind === 'list' ? (
      <List key={key} items={run.items} start={run.start} />
    ) : run.kind === 'text' ? (
      <p key={key} className="m-0 leading-[1.65] break-words whitespace-pre-wrap">
        {run.text}
      </p>
    ) : null,
  )
}

function List({ items, start }: { items: string[]; start: number | undefined }) {
  const lis = keyed(items, item => item).map(([k, item]) => (
    <li key={k} className="break-words">
      {item}
    </li>
  ))
  return start === undefined ? (
    <ul className="m-0 list-disc pl-5 leading-[1.65]">{lis}</ul>
  ) : (
    <ol start={start} className="m-0 list-decimal pl-6 leading-[1.65]">
      {lis}
    </ol>
  )
}

const runKey = (run: Block | Action[]) =>
  Array.isArray(run)
    ? run.map(a => a.verb).join(' ')
    : run.kind === 'text'
      ? run.text
      : run.kind === 'list'
        ? run.items.join('\n')
        : run.verb

// "calc.py (+1 -1)": an edit's file, then lines added and removed.
const EDIT = /^(.*?)\s*\((\+\d+) (-\d+)\)$/

function ActionRow({ action }: { action: Action }) {
  const [open, setOpen] = useState(false)
  const output = action.output.length > 0
  // A call such as Explored names its targets in its output.
  const target = action.target || action.output[0] || ''
  const edit = EDIT.exec(target)
  return (
    <div className="border-line not-first:border-t">
      <button
        type="button"
        disabled={!output}
        aria-expanded={output ? open : undefined}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left text-[12.5px] text-text enabled:cursor-pointer enabled:hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight
          size={13}
          className={`flex-none text-faint transition-transform ${open ? 'rotate-90' : ''} ${output ? '' : 'invisible'}`}
        />
        <span className="min-w-[52px] flex-none text-muted">{action.verb}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{edit ? edit[1] : target}</span>
        {edit ? (
          <span className="flex-none font-mono text-xs">
            <span className="text-ok">{edit[2]}</span> <span className="text-danger">{edit[3]}</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <pre className="m-0 overflow-auto bg-raised-2 py-2 pr-3 pl-[33px] font-mono text-xs leading-normal whitespace-pre-wrap text-muted">
          {action.output.join('\n')}
        </pre>
      ) : null}
    </div>
  )
}

/** Copies what the agent said in the turn, leaving out its tool calls. */
function CopyReply({ blocks }: { blocks: Block[] }) {
  const t = useI18n()
  const [copied, setCopied] = useState(false)
  const text = blocks
    .flatMap(b => (b.kind === 'text' ? [b.text] : b.kind === 'list' ? [listText(b.items, b.start)] : []))
    .join('\n\n')
  if (!text) return null
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      err => console.error('could not copy', err),
    )
  return (
    <button
      type="button"
      onClick={copy}
      onBlur={() => setCopied(false)}
      className="absolute top-1.5 right-2 inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[5px] border border-line bg-raised px-2 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Copy size={12} />
      {copied ? t('copied') : t('copy')}
    </button>
  )
}

const listText = (items: string[], start: number | undefined) =>
  items.map((item, i) => `${start === undefined ? '-' : `${start + i}.`} ${item}`).join('\n')

/** Keys for a list from its items' content, numbered where the content repeats. */
function keyed<T>(items: T[], keyOf: (item: T) => string): [string, T][] {
  const seen = new Map<string, number>()
  return items.map(item => {
    const k = keyOf(item)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return [`${n}:${k}`, item]
  })
}
