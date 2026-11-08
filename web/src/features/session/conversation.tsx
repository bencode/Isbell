// A session's conversation as a chat: what was asked on the right, what the agent said and did
// under it, the day between turns on different days; the last turn shows the agent at work, or that
// it asks. What was just sent shows after it until the record has it.

import { Copy } from 'lucide-react'
import { type ReactNode, useContext, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { modelName } from '../../model/chat/tools'
import type { Asked, ChatTurn } from '../../model/chat/types'
import { splitUploads } from '../../model/files/uploads'
import type { AgentStatus } from '../../model/state'
import { clock, dayTitle, duration, since, useNow } from '../../utils/time'
import { Items } from './chat-items'
import { PathRoot } from './context'
import { MentionText } from './mention-text'
import { PromptImages } from './prompt-images'

/** A line across the chat with words or a button on it, such as where the turns shown begin. */
export function Marker({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 mb-[18px] flex items-center gap-2.5 text-xs text-faint before:flex-1 before:border-t before:border-line after:flex-1 after:border-t after:border-line">
      {children}
    </div>
  )
}

/** Reads the turns before those shown. */
export function EarlierButton({ onClick, paging }: { onClick: () => void; paging: boolean }) {
  const t = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={paging}
      className="h-[26px] cursor-pointer rounded-full border border-line bg-raised px-3 text-xs font-medium text-accent enabled:hover:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-faint"
    >
      {paging ? t('chat.readingEarlier') : t('chat.showEarlier')}
    </button>
  )
}

/** What was sent and is not in the record yet, and when. */
export type Pending = { text: string; at: number }

const NAMES: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', pi: 'pi' }

export function Conversation({
  turns,
  kind,
  status,
  statusSince,
  top,
  asking,
  pending,
}: {
  turns: ChatTurn[]
  kind: string | undefined
  status: AgentStatus
  statusSince: number
  /** Where the turns shown begin. */
  top: ReactNode
  /** That the agent asks, shown under its last turn. */
  asking: ReactNode
  /** What was sent and is not in the record yet, in order. */
  pending?: readonly Pending[]
}) {
  const t = useI18n()
  const now = useNow(60_000)
  const day = (ms: number) =>
    dayTitle(t.locale, ms, now, { today: t('sessions.today'), yesterday: t('sessions.yesterday') })
  return (
    <div className="flex flex-col">
      {top}
      {turns.map((turn, i) => {
        const before = turns[i - 1]?.at ?? 0
        const newDay = turn.at > 0 && new Date(turn.at).toDateString() !== new Date(before).toDateString()
        const last = i === turns.length - 1
        return (
          <div key={turn.id} className="contents">
            {newDay ? (
              <div className="mb-5 flex items-center gap-2.5 text-[11.5px] text-faint before:flex-1 before:border-t before:border-dashed before:border-line after:flex-1 after:border-t after:border-dashed after:border-line">
                {day(turn.at)} {clock(t.locale, turn.at)}
              </div>
            ) : null}
            <Turn
              turn={turn}
              name={NAMES[kind ?? ''] ?? kind ?? ''}
              working={last && status === 'working'}
              statusSince={statusSince}
              asking={last ? asking : null}
            />
          </div>
        )
      })}
      {turns.length ? null : asking}
      {pending?.map(({ text, at }) => (
        <section key={at} className="mb-[26px] flex flex-col items-end gap-1.5">
          <You asked={{ ...splitUploads(text), data: [] }} at={0} />
          <span className="font-mono text-[11px] text-faint">{t('chat.sent')}</span>
        </section>
      ))}
    </div>
  )
}

function Turn({
  turn,
  name,
  working,
  statusSince,
  asking,
}: {
  turn: ChatTurn
  name: string
  working: boolean
  statusSince: number
  asking: ReactNode
}) {
  const t = useI18n()
  const said = turn.items.length > 0 || working || asking
  const when = [
    turn.at ? clock(t.locale, turn.at) : '',
    turn.took ? t('chat.took', { time: duration(turn.took) }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="mb-[26px] flex flex-col gap-2.5">
      {turn.you ? <You asked={turn.you} at={turn.at} /> : null}
      {said ? (
        <div className="group/reply flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs text-faint">
            <span
              aria-hidden="true"
              className="grid size-[18px] place-items-center rounded-[5px] border border-line bg-raised-2 font-mono text-[10px] font-semibold text-muted"
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
            <b className="text-[12.5px] font-semibold text-text">{name}</b>
            {turn.model ? <span>{modelName(turn.model)}</span> : null}
          </div>
          <Items items={turn.items} working={working} />
          {asking}
          {working ? <Working since={statusSince} /> : null}
          {!working && !asking ? <Foot turn={turn} when={when} /> : null}
        </div>
      ) : null}
    </section>
  )
}

/** What was asked, on the right: its images, then its words. */
function You({ asked, at }: { asked: Asked; at: number }) {
  const t = useI18n()
  const mid = useContext(PathRoot)?.project.mid
  return (
    <div className="group/you flex max-w-[min(82%,560px)] flex-col items-end gap-1.5 self-end">
      {mid && asked.images.length ? <PromptImages mid={mid} paths={asked.images} /> : null}
      {asked.data.length ? (
        <div className="flex flex-wrap justify-end gap-2">
          {asked.data.map(src => (
            <img
              key={src.slice(-48)}
              src={src}
              alt=""
              className="max-h-28 max-w-40 rounded-lg border border-line object-cover"
            />
          ))}
        </div>
      ) : null}
      {asked.text.trim() ? (
        <div className="rounded-[14px_14px_4px_14px] bg-accent-soft px-[13px] py-[9px] leading-[1.6] break-words whitespace-pre-wrap">
          <MentionText text={asked.text} />
        </div>
      ) : null}
      {at ? (
        <span className="font-mono text-[11px] text-faint opacity-0 transition-opacity group-hover/you:opacity-100">
          {clock(t.locale, at)}
        </span>
      ) : null}
    </div>
  )
}

function Working({ since: from }: { since: number }) {
  const t = useI18n()
  const now = useNow(1000)
  return (
    <p className="m-0 flex items-center gap-2 text-[12.5px] font-medium text-accent">
      <span className="size-[7px] animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      {t('chat.working')}
      <span className="font-mono text-[11.5px] font-normal text-faint">{since(from, now)}</span>
    </p>
  )
}

/** When the turn was and how long it took, and a way to copy what the agent said, on hover. */
function Foot({ turn, when }: { turn: ChatTurn; when: string }) {
  const t = useI18n()
  const [copied, setCopied] = useState(false)
  const text = turn.items.flatMap(item => (item.kind === 'text' ? [item.text] : [])).join('\n\n')
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      (err: unknown) => console.error('could not copy', err),
    )
  if (!when && !text) return null
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-faint opacity-0 transition-opacity group-hover/reply:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      {when ? <span>{when}</span> : null}
      {text ? (
        <button
          type="button"
          onClick={copy}
          onBlur={() => setCopied(false)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 font-sans text-[11.5px] text-faint hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Copy size={11} />
          {copied ? t('copied') : t('chat.copyReply')}
        </button>
      ) : null}
    </div>
  )
}
