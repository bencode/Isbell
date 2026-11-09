// What an agent said and did in a turn, as the chat shows it: its words (in Markdown when its record
// was read), its thinking folded away, and its tool calls, those in a row sharing one box that folds
// to a line when nothing in it changed a file or went wrong.

import { ChevronRight, FileText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { type MarkdownLink, MessageMarkdown } from '../../components/renderers/markdown/message'
import { useI18n } from '../../core/i18n'
import type { ChatItem, ToolItem } from '../../model/chat/types'
import { keyed } from '../../utils/keyed'
import { duration } from '../../utils/time'
import { MentionText, useMentions } from './mention-text'

type Run = ChatItem | ToolItem[]

/** The items in order, tool calls that follow one another in one run. */
const runsOf = (items: ChatItem[]) =>
  items.reduce<Run[]>((acc, item) => {
    const last = acc.at(-1)
    if (item.kind === 'tool' && Array.isArray(last)) last.push(item)
    else acc.push(item.kind === 'tool' ? [item] : item)
    return acc
  }, [])

const runKey = (run: Run) =>
  Array.isArray(run)
    ? `tools ${run[0]?.id}`
    : run.kind === 'text' || run.kind === 'thinking'
      ? run.text
      : run.kind === 'note'
        ? `note ${run.note}`
        : run.id

/** `working`: the agent is still at it, so a call without its result yet is the one running. */
export function Items({ items, working }: { items: ChatItem[]; working: boolean }) {
  return keyed(runsOf(items), runKey).map(([key, run]) =>
    Array.isArray(run) ? (
      <Tools key={key} tools={run} working={working} />
    ) : run.kind === 'text' ? (
      <ChatText key={key} text={run.text} />
    ) : run.kind === 'thinking' ? (
      <Thinking key={key} text={run.text} ms={run.ms} />
    ) : run.kind === 'note' ? (
      <Note key={key} note={run.note} text={run.text} />
    ) : null,
  )
}

const FOLD =
  'flex max-w-full cursor-pointer items-center gap-[7px] self-start rounded-md border-0 bg-transparent py-[3px] pr-1.5 pl-0.5 -ml-0.5 text-left text-[12.5px] text-faint hover:bg-hover hover:text-muted focus-visible:outline-2 focus-visible:outline-accent'

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight size={13} className={`flex-none transition-transform ${open ? 'rotate-90' : ''}`} />
}

function Thinking({ text, ms }: { text: string; ms: number | undefined }) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className={FOLD}>
        <Chevron open={open} />
        {ms === undefined ? t('chat.thought') : t('chat.thoughtFor', { time: duration(ms) })}
      </button>
      {open ? (
        <p className="m-0 border-l-2 border-line py-0.5 pl-3 text-[13px] leading-[1.65] whitespace-pre-wrap text-muted italic">
          {text}
        </p>
      ) : null}
    </>
  )
}

function Note({ note, text }: { note: 'interrupted' | 'failed' | 'compacted'; text: string | undefined }) {
  const t = useI18n()
  return (
    <p className={`m-0 text-[12.5px] ${note === 'failed' ? 'text-danger' : 'text-faint'}`}>
      {t(`chat.${note}`)}
      {text ? ` · ${text}` : ''}
    </p>
  )
}

/** Words in Markdown, their links and the paths they name opening in the app. */
function ChatText({ text }: { text: string }) {
  const t = useI18n()
  const mentions = useMentions()
  const navigate = useNavigate()
  const link = useCallback(
    (href: string): MarkdownLink => {
      if (/^https?:\/\//.test(href)) return { kind: 'external' }
      const [found] = mentions?.find(href) ?? []
      if (typeof found === 'object' && found.text === href) {
        const to = mentions?.href(found) ?? ''
        return { kind: 'internal', href: to, open: () => navigate(to) }
      }
      return { kind: 'inert' }
    },
    [mentions, navigate],
  )
  const words = useCallback((s: string) => <MentionText text={s} />, [])
  const labels = useMemo(() => ({ copy: t('copy'), copied: t('copied') }), [t])
  return <MessageMarkdown text={text} link={link} words={words} labels={labels} />
}

/** A run of calls: one line saying how many of each when it folds, the calls when open. */
function Tools({ tools, working }: { tools: ToolItem[]; working: boolean }) {
  const t = useI18n()
  // Calls that changed a file or went wrong are worth seeing, the rest fold away, as the run goes
  // on; once folded or opened by hand, it stays so.
  const [toggled, setToggled] = useState<boolean>()
  const open = toggled ?? (tools.some(tool => tool.edit || tool.error) || tools.length === 1)
  const counts = tools.reduce<Map<string, number>>(
    (acc, tool) => acc.set(tool.name, (acc.get(tool.name) ?? 0) + 1),
    new Map(),
  )
  const last = tools.at(-1)
  const running = working && last && !last.done ? last : undefined
  return (
    <>
      {tools.length > 1 ? (
        <button type="button" aria-expanded={open} onClick={() => setToggled(!open)} className={FOLD}>
          <Chevron open={open} />
          <span>{t('chat.tools', { n: tools.length })}</span>
          <span className="flex flex-wrap gap-1.5 font-mono text-[11.5px] text-muted">
            {[...counts].map(([name, n]) => (
              <span key={name}>
                {name} {n}
              </span>
            ))}
          </span>
        </button>
      ) : null}
      {open ? (
        <div className="overflow-hidden rounded-lg border border-line bg-raised">
          {tools.map(tool => (
            <ToolRow key={tool.id} tool={tool} running={tool === running} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function ToolRow({ tool, running }: { tool: ToolItem; running: boolean }) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const output = tool.output !== undefined && tool.output.length > 0
  // A call on one file, such as an edit or a read, opens it.
  const mentions = useMentions()
  const [file] = mentions?.find(tool.target) ?? []
  const opens = typeof file === 'object' && file.text === tool.target && !file.dir ? file : null
  return (
    <div className="border-line not-first:border-t">
      <div className="flex items-center">
        <button
          type="button"
          disabled={!output}
          aria-expanded={output ? open : undefined}
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-2.5 py-[5px] text-left text-[12.5px] text-text enabled:cursor-pointer enabled:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronRight
            size={13}
            className={`flex-none text-faint transition-transform ${open ? 'rotate-90' : ''} ${output ? '' : 'invisible'}`}
          />
          <span className={`min-w-[48px] flex-none ${tool.error ? 'text-danger' : 'text-muted'}`}>
            {tool.name}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{tool.target}</span>
          {tool.edit ? (
            <span className="flex-none font-mono text-[11.5px]">
              <span className="text-ok">+{tool.edit.add}</span>{' '}
              <span className="text-danger">−{tool.edit.del}</span>
            </span>
          ) : null}
          {tool.error ? (
            <span className="flex-none font-mono text-[11px] text-danger">{t('chat.toolFailed')}</span>
          ) : null}
          {running ? (
            <span
              role="status"
              aria-label={t('chat.working')}
              className="size-[11px] flex-none animate-spin rounded-full border-[1.5px] border-accent/30 border-t-accent motion-reduce:animate-none"
            />
          ) : null}
        </button>
        {opens ? (
          <Link
            to={mentions?.href(opens) ?? ''}
            aria-label={t('files.openFile')}
            title={t('files.openFile')}
            className="mr-1.5 inline-flex size-[22px] flex-none pointer-coarse:mr-0 pointer-coarse:size-11 items-center justify-center rounded-[5px] text-faint hover:bg-hover hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FileText size={14} />
          </Link>
        ) : null}
      </div>
      {open ? (
        <pre className="m-0 max-h-60 overflow-auto border-t border-line bg-raised-2 py-2 pr-3 pl-[33px] font-mono text-xs leading-normal whitespace-pre-wrap text-muted">
          {tool.output}
        </pre>
      ) : null}
    </div>
  )
}
