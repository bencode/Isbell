// What every card on the board shares: its frame, its head, the note it keeps once answered until
// the agent moves on, and ending the agent from it.

import { CircleHelp, ClipboardList, FilePen, MessageSquareText, Power, SquareTerminal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router'
import { type Ending, endNow, endSoon, undoEnd } from '../../../core/ending'
import { errorText, type Key, type T, useI18n } from '../../../core/i18n'
import { useSpace } from '../../../core/space'
import type { AgentNote, ToolUse } from '../../../model/agent-note'
import type { Placed, Session } from '../../../model/projects'
import { tailLines } from '../../../model/screen'
import type { Block, Reading } from '../../../model/screen/types'
import { boardHref, peekHref } from '../../../utils/hrefs'
import { since } from '../../../utils/time'

/** The turn still going, or else the last one ended. */
export const lastTurn = (reading: Reading | null): { prompt?: string; reply: Block[] } | undefined =>
  reading?.live?.reply.length ? reading.live : reading?.turns.at(-1)

/** What the agent said last: the turn still going, or else the last one ended. */
export const lastReply = (reading: Reading | null): Block[] | undefined => lastTurn(reading)?.reply

/** The last paragraph of what the agent said last. */
export const lastWords = (reading: Reading | null): string | undefined =>
  lastReply(reading)
    ?.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .at(-1)?.text

/** The last `n` lines of what a working agent is doing: of the turn going on, even while it has
 * said nothing yet (the one before would pass for it), or of its screen when not read as turns. */
export const workingTail = (reading: Reading | null, text: string | null, n: number): string[] =>
  reading
    ? tailLines(reading.live ? reading.live.reply : (reading.turns.at(-1)?.reply ?? []), n)
    : (text ?? '')
        .split('\n')
        .filter(l => l.trim())
        .slice(-n)

/** `sent` fades the card while what was sent, or its ending, takes effect. */
export function Card({ ask, sent, children }: { ask?: boolean; sent?: boolean; children: ReactNode }) {
  const frame = sent
    ? 'border-dashed border-line-strong opacity-60'
    : `index-card ${ask ? 'border-ask-line' : 'border-line'}`
  return (
    <div className={`flex flex-col gap-2 rounded-[10px] border bg-raised px-3 py-2.5 ${frame}`}>
      {children}
    </div>
  )
}

/** The agent's task, else its name, how long it has been so, what else the card does in a word
 * (`actions`), and the button that opens it; under them, the agent's name when the task stands in
 * its place, where it runs unless the board is all one project's, and its mode when not the
 * default. `title` takes the task's place, which then moves under it. */
export function CardHead({
  placed: { session, project },
  now,
  scoped,
  note,
  title,
  lead,
  actions,
}: {
  placed: Placed
  now: number
  scoped: boolean
  note: AgentNote | undefined
  title?: ReactNode
  lead?: ReactNode
  actions?: ReactNode
}) {
  const t = useI18n()
  const task = note?.title
  const meta = [
    title ? task : undefined,
    title || task ? session.name : undefined,
    scoped ? undefined : `${project.name} · ${project.machine}`,
  ].filter(Boolean)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {lead}
        <b className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title ?? task ?? session.name}</b>
        <span className="mr-0.5 flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
        {actions}
        <OpenButton session={session} />
      </div>
      {meta.length > 0 || note?.mode ? (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-faint">
          <span className="min-w-0 truncate">{meta.join(' · ')}</span>
          {note?.mode ? (
            <span className="flex-none rounded-full border border-accent bg-accent-soft px-1.5 text-[11px] leading-4 text-accent">
              {modeLabel(t, note.mode)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])
const FILES = new Set(['Read', 'Write', ...EDITS])

/** A tool an agent runs or asks to, in words: what Claude says a command is for, else the command,
 * or what the tool does to what. */
export function toolText(t: T, { tool, target }: ToolUse): string {
  const on = target ?? ''
  if (tool === 'Bash') return target ?? t('tool.run')
  if (tool === 'Read') return t('tool.read', { file: on })
  if (tool === 'Write') return t('tool.write', { file: on })
  if (EDITS.has(tool)) return t('tool.edit', { file: on })
  if (tool === 'Grep' || tool === 'Glob') return t('tool.search', { what: on })
  if (tool === 'WebFetch' || tool === 'WebSearch') return t('tool.web', { what: on })
  if (tool === 'Agent' || tool === 'Task') return t('tool.agent', { what: on })
  if (tool === 'ExitPlanMode') return t('tool.plan', { plan: on })
  return target ? `${tool} ${target}` : tool
}

/** What kind of thing an agent asks leave for: a command, a file, a plan, or something else. */
export function ToolMark({ tool }: { tool: string }) {
  const Icon =
    tool === 'Bash'
      ? SquareTerminal
      : FILES.has(tool)
        ? FilePen
        : tool === 'ExitPlanMode'
          ? ClipboardList
          : CircleHelp
  return <Icon size={15} className="flex-none text-warn" />
}

const MODES: Record<string, Key> = {
  plan: 'mode.plan',
  auto: 'mode.auto',
  acceptEdits: 'mode.acceptEdits',
  bypassPermissions: 'mode.bypass',
}

export const modeLabel = (t: T, mode: string) => {
  const key = MODES[mode]
  return key ? t(key) : mode
}

/** A small icon button for a card's head, where words would crowd it; `on` while what it opens is
 * open. Its colours are one or the other, since classes setting the same one do not override. */
export const headButton = (on = false) =>
  `inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 no-underline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 ${on ? 'bg-accent-soft text-accent' : 'bg-transparent text-faint hover:bg-raised-2'}`

/** The one way into a session from its card, beside the board: the card itself is for acting on it
 * in place. On the session open beside the board, it closes it. */
export function OpenButton({ session }: { session: Session }) {
  const t = useI18n()
  const { key, mid, pane } = useParams()
  const open = mid === session.mid && pane === session.paneId
  const label = t(open ? 'card.close' : 'card.open')
  return (
    <Link
      to={open ? boardHref(key) : peekHref(key, session.mid, session.paneId)}
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={`${headButton(open)} ${open ? '' : 'hover:text-accent'}`}
    >
      <MessageSquareText size={14} />
    </Link>
  )
}

/** What was sent, kept while the session is still as it was then; any change of status ends it. */
export function useSent(session: Session) {
  const [sent, setSent] = useState<{ what: string; at: number }>()
  return {
    sent: sent?.at === session.statusSince ? sent.what : undefined,
    markSent: (what: string) => setSent({ what, at: session.statusSince }),
    unsend: () => setSent(undefined),
  }
}

/** What was sent; when it did not take, `onAgain` brings the card back to answer. */
export function SentNote({ what, onAgain }: { what: string; onAgain: () => void }) {
  const t = useI18n()
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
      {t('card.sent', { what })}
      <button
        type="button"
        onClick={onAgain}
        className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline"
      >
        {t('card.again')}
      </button>
    </p>
  )
}

/** An agent's pane or a plain shell's. */
type PaneAt = { mid: string; paneId: string }

/** Ends the agent (or shell) after a moment, in which its card offers to undo it; so it asks nothing. */
export function EndButton({ pane: { mid, paneId } }: { pane: PaneAt }) {
  const t = useI18n()
  const { call } = useSpace()
  return (
    <button
      type="button"
      onClick={() => endSoon(call, mid, paneId)}
      aria-label={t('card.end')}
      title={t('card.end')}
      className={`${headButton()} hover:text-danger`}
    >
      <Power size={13} />
    </button>
  )
}

const LINK = 'cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline'

/** What stands in for the card while the agent (or shell) is being ended: the way to undo it while it may
 * be, and why it failed, if it did. */
export function EndingNote({ pane: { mid, paneId }, ending }: { pane: PaneAt; ending: Ending }) {
  const t = useI18n()
  const { call } = useSpace()
  const undo = (
    <button type="button" onClick={() => undoEnd(mid, paneId)} className={LINK}>
      {t('end.undo')}
    </button>
  )
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
      {ending === 'soon' ? (
        <>
          {t('end.soon')}
          {undo}
        </>
      ) : ending === 'closing' ? (
        t('end.closing')
      ) : (
        <>
          <span className="text-danger">{t('end.failed', { msg: errorText(t, ending.failed) })}</span>
          <button type="button" onClick={() => void endNow(call, mid, paneId)} className={LINK}>
            {t('end.retry')}
          </button>
          {undo}
        </>
      )}
    </p>
  )
}
