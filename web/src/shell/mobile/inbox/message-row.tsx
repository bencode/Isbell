// A message on a phone, as the inbox and a task list it: its kind, title, and its text or latest
// reply; a file it links to, opened to read; who sent it, the task it is about, and when it was last
// active. The whole of it opens the session that sent it, the message pinned over its chat, or the
// record of that session once it ended.

import { Link } from 'react-router'
import { type Posted, useRunningSession } from '../../../core/books'
import { useProjects } from '../../../core/space'
import { AGENT_NAMES } from '../../../features/session/session-row'
import { projectHolding } from '../../../model/files/worktrees'
import { lastActive, type Message, type MessageKind, parseLink } from '../../../model/messages'
import type { Placed } from '../../../model/projects'
import { endedHref, sessionHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'
import { FileChip, Owner, taskHref } from '../tasks/parts'
import { PIN } from './pinned'

const KINDS: Readonly<Record<MessageKind, { glyph: string; tone: string }>> = {
  ask: { glyph: '?', tone: 'bg-warn/15 text-warn' },
  warn: { glyph: '!', tone: 'bg-danger/15 text-danger' },
  done: { glyph: '✓', tone: 'bg-ok/15 text-ok' },
  info: { glyph: 'i', tone: 'bg-raised-2 text-faint' },
}

/** The agent running the session that sent a message, and where the message opens: that session,
 * the message pinned in it; else its record; nowhere without a sender. */
function useSender(): (mid: string, message: Message) => { placed?: Placed; to?: string } {
  const running = useRunningSession()
  const projects = useProjects()
  return (mid, { id, from }) => {
    if (!from) return {}
    const placed = running(mid, from.agent, from.session)
    if (placed) return { placed, to: `${sessionHref(mid, placed.session.paneId)}?${PIN}=${id}` }
    const at = projectHolding(projects, mid, from.dir)
    return at ? { to: endedHref(at.project.key, from.agent, from.session) } : {}
  }
}

type Props = {
  posted: Posted
  /** Whether to say which machine it is on, as when there are more than one. */
  named: boolean
  now: number
  /** Listed on its task's page, which shows the task and its files already. */
  onTask?: boolean
}

export function MessageRow({ posted, named, now, onTask = false }: Props) {
  const { mid, name, message } = posted
  const { placed, to } = useSender()(mid, message)
  const kind = KINDS[message.kind]
  const heading = message.title ?? message.text
  const line = message.replies.at(-1)?.text ?? (message.title ? message.text : undefined)
  const found = message.link ? parseLink(message.link) : undefined
  const from = message.from
  const who = from && (from.role ?? AGENT_NAMES[from.agent] ?? from.agent)
  const title = 'text-[14px] leading-snug font-semibold [overflow-wrap:anywhere]'
  return (
    <article className={`relative flex gap-2.5 px-3 py-2.5 ${to ? 'active:bg-press' : ''}`}>
      <span
        aria-hidden
        className={`mt-px grid size-5 flex-none place-items-center rounded-full text-[11px] font-bold ${kind.tone}`}
      >
        {kind.glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {to ? (
          <Link
            to={to}
            className={`${title} text-text no-underline after:absolute after:inset-0 after:content-['']`}
          >
            {heading}
          </Link>
        ) : (
          <span className={title}>{heading}</span>
        )}
        {line ? (
          <p className="m-0 line-clamp-2 text-[12.5px] text-muted [overflow-wrap:anywhere]">{line}</p>
        ) : null}
        {found?.kind === 'file' && !onTask ? (
          <div className="relative z-[1] mt-1">
            <FileChip mid={mid} path={found.path} />
          </div>
        ) : null}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
          {who ? (
            <span className="flex max-w-[50%] min-w-0 flex-none">
              <Owner name={who} agent={placed} />
            </span>
          ) : null}
          {message.task === undefined || onTask ? null : (
            <Link
              to={taskHref(mid, message.task)}
              className="relative z-[1] flex-none rounded px-0.5 font-mono text-[11px] text-faint no-underline active:bg-press"
            >
              T{message.task}
            </Link>
          )}
          <span className="flex-none">{since(lastActive(message), now)}</span>
          {named ? <span className="min-w-0 truncate">· {name}</span> : null}
        </div>
      </div>
    </article>
  )
}
