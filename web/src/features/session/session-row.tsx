// A session in a project's list: the agent it runs under, with how it stands, what it is about and
// when, and under that what you last asked it and any worktree's branch. A click shows it in the
// preview tab, a double click keeps it; a menu beside it does what else there is to do with it.

import { Clock, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, type To } from 'react-router'
import { DropdownMenu, type MenuItem } from '../../components/menu'
import type { AgentStatus } from '../../model/state'

/** A shell, or the agent of a session, with its status while it runs. */
type Mark = 'shell' | { agent: string; status?: AgentStatus | undefined }

type Props = {
  mark: Mark
  name: string
  detail?: string | undefined
  /** `detail` is what you asked it. */
  said?: boolean | undefined
  branch?: string | undefined
  time?: ReactNode
  /** It has a scheduled message running. */
  looping?: boolean | undefined
  /** Shown on hovering the row. */
  hint?: string | undefined
  /** It is hidden from the list, and shown as asked. */
  faded?: boolean | undefined
  menu?: MenuItem[] | undefined
  menuLabel?: string | undefined
  /** What is searched for, in lower case, to pick out. */
  needle: string
  shown: boolean
  to: To
  onKeep: () => void
}

const LETTERS: Readonly<Record<string, string>> = { claude: 'C', codex: 'X', pi: 'π' }
/** The dot before the letter, for statuses worth one: one standing by needs nothing said. A working
 * agent's ring starts a little out from its dot, to read at its size. */
const DOTS: Partial<Readonly<Record<AgentStatus, string>>> = {
  blocked: 'bg-warn',
  done: 'bg-ok',
  working:
    "bg-accent after:absolute after:-inset-px after:rounded-full after:bg-accent after:content-[''] after:animate-ring motion-reduce:after:hidden",
}

/** How far a row's second line sits in, under its title: the mark, then the gap after it. */
const UNDER_MARK = 'pl-[30px]'

/** The status dot in a slot of its own, kept for every row so dots and letters line up, then the
 * agent's letter, or a shell's square. */
export function AgentMark({ mark }: { mark: Mark }) {
  const dot = mark === 'shell' || !mark.status ? undefined : DOTS[mark.status]
  return (
    <span className="flex flex-none items-center gap-1">
      <span aria-hidden className={`relative size-1.5 flex-none rounded-full ${dot ?? ''}`} />
      {mark === 'shell' ? (
        <span className="mx-0.5 size-2 flex-none rounded-[2px] bg-line-strong" />
      ) : (
        <span title={mark.agent} className="w-3 text-center font-mono text-[11px] font-medium text-faint">
          {LETTERS[mark.agent] ?? mark.agent.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function Marked({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return text
  const end = at + needle.length
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-accent-soft px-px text-inherit">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export function SessionRow({
  mark,
  name,
  detail,
  said,
  branch,
  time,
  looping,
  hint,
  faded,
  menu,
  menuLabel,
  needle,
  shown,
  to,
  onKeep,
}: Props) {
  const under = detail || branch
  // Hovering, or with its menu open, the row shows the menu's button where its time is.
  const behindMenu = menu
    ? 'group-hover:invisible group-has-[[data-popup-open]]:invisible group-has-[button:focus-visible]:invisible'
    : ''
  return (
    <div className={`group relative mb-px ${faded ? 'opacity-60' : ''}`}>
      <Link
        to={to}
        title={hint}
        onDoubleClick={onKeep}
        aria-current={shown ? 'page' : undefined}
        className={`block rounded-[7px] px-2 text-inherit no-underline transition-colors duration-75 hover:bg-hover active:bg-press focus-visible:outline-2 focus-visible:outline-accent ${under ? 'pt-[5px] pb-1.5' : 'py-[3px]'} ${shown ? 'bg-selected' : ''}`}
      >
        <span className="flex min-w-0 items-center gap-2 text-[13.5px] leading-5">
          <AgentMark mark={mark} />
          <span className="min-w-0 flex-1 truncate">
            <Marked text={name} needle={needle} />
          </span>
          {looping ? <Clock size={11} className="flex-none text-faint" /> : null}
          {time ? <span className={`flex flex-none ${behindMenu}`}>{time}</span> : null}
        </span>
        {under ? (
          <span
            className={`mt-[3px] flex min-w-0 gap-1.5 ${UNDER_MARK} text-xs leading-4 ${shown ? 'text-muted' : 'text-faint'}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {said && detail ? <span className="mr-1 font-semibold text-muted">›</span> : null}
              {detail ? <Marked text={detail} needle={needle} /> : null}
            </span>
            {branch ? (
              <span className="max-w-24 flex-none truncate font-mono text-[11px] text-muted">{branch}</span>
            ) : null}
          </span>
        ) : null}
      </Link>
      {menu?.length ? (
        <DropdownMenu
          items={menu}
          trigger={
            <button
              type="button"
              aria-label={menuLabel}
              title={menuLabel}
              className="absolute top-[3px] right-1.5 grid size-5 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 text-muted opacity-0 hover:bg-hover hover:text-text focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover:opacity-100 data-[popup-open]:opacity-100"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
      ) : null}
    </div>
  )
}
