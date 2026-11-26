// A message in the right column: its kind, number and title, the text and the latest replies under
// them, and what it is about at the foot, with how long since it was last active. Opened, it shows
// all of its text and every reply; each tag at its foot goes where it says.

import type { ReactNode } from 'react'
import { Link, type To } from 'react-router'
import { useI18n } from '../../core/i18n'
import { lastActive, type Message, type MessageKind } from '../../model/messages'
import { since } from '../../utils/time'

const KINDS: Readonly<Record<MessageKind, { glyph: string; tone: string }>> = {
  ask: { glyph: '?', tone: 'text-warn' },
  warn: { glyph: '!', tone: 'text-danger' },
  done: { glyph: '✓', tone: 'text-ok' },
  info: { glyph: 'i', tone: 'text-faint' },
}

/** Replies shown while a message is not opened, the latest. */
const LATEST = 2

/** What a message is about, at its foot: an agent looked at (`onPeek`), a place gone to (`to`), or
 * neither. `gone`: its session ended. */
export type Tag = {
  key: string
  label: ReactNode
  title?: string
  to?: To
  onPeek?: () => void
  tone?: 'gone' | 'task'
}

const TAG = 'relative z-[1] max-w-full truncate rounded px-[5px] text-[11px] leading-[17px] no-underline'
const TONES = {
  plain: 'bg-selected text-muted',
  gone: 'border border-dashed border-line-strong text-faint',
  task: 'bg-accent-soft text-accent',
}
const GOES = 'cursor-pointer hover:text-text focus-visible:outline-2 focus-visible:outline-accent'

function TagView({ tag }: { tag: Tag }) {
  const look = `${TAG} ${TONES[tag.tone ?? 'plain']}`
  if (tag.onPeek)
    return (
      <button type="button" onClick={tag.onPeek} title={tag.title} className={`${look} ${GOES} border-0`}>
        {tag.label}
      </button>
    )
  if (tag.to)
    return (
      <Link to={tag.to} title={tag.title} className={`${look} ${GOES}`}>
        {tag.label}
      </Link>
    )
  return (
    <span title={tag.title} className={look}>
      {tag.label}
    </span>
  )
}

type Props = { message: Message; tags: Tag[]; open: boolean; onToggle: () => void; now: number }

export function MessageRow({ message, tags, open, onToggle, now }: Props) {
  const t = useI18n()
  const kind = KINDS[message.kind]
  const replies = open ? message.replies : message.replies.slice(-LATEST)
  const earlier = message.replies.length - replies.length
  const active = lastActive(message)
  const age = (ms: number) => (
    <span
      title={new Date(ms).toLocaleString(t.locale)}
      className="flex-none font-mono text-[11px] text-faint"
    >
      {since(ms, now)}
    </span>
  )
  return (
    <div
      className={`relative flex flex-none flex-col gap-1 rounded-lg border-b border-line px-2.5 pt-2 pb-[7px] transition-colors duration-75 ${open ? 'bg-selected' : 'hover:bg-hover'}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`grid h-[15px] w-[15px] flex-none place-items-center rounded-full border-[1.5px] font-mono text-[9.5px] leading-none font-bold ${kind.tone}`}
        >
          {kind.glyph}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 border-0 bg-transparent p-0 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-accent"
        >
          <span className="flex-none font-mono text-[11px] text-faint">M{message.id}</span>
          {message.title ? (
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-text">{message.title}</span>
          ) : null}
        </button>
      </div>
      {message.text ? (
        <p
          className={`m-0 text-xs whitespace-pre-line text-muted [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-4'}`}
        >
          {message.text}
        </p>
      ) : null}
      {earlier ? (
        <span className="ml-3.5 text-[11.5px] text-faint">{t('messages.earlier', { n: earlier })}</span>
      ) : null}
      {replies.map(reply => (
        <div
          key={`${reply.time}:${reply.text}`}
          className="ml-3.5 flex gap-2 border-l-2 border-line pl-2 text-xs text-muted"
        >
          <span
            className={`min-w-0 flex-1 whitespace-pre-line [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-2'}`}
          >
            {open && reply.role ? <b className="mr-1 font-semibold text-text">{reply.role}</b> : null}
            {reply.text}
          </span>
          {age(reply.time)}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {tags.map(tag => (
          <TagView key={tag.key} tag={tag} />
        ))}
        <span className="ml-auto">{age(active)}</span>
      </div>
    </div>
  )
}
