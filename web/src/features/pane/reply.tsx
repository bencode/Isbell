// What the agent said in a turn: its text and lists as written, tool calls folded to a line each
// that opens onto their output, and a way to copy the words.

import { ChevronRight, Copy } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../core/i18n'
import type { Block } from '../../model/screen/types'
import { keyed } from '../../utils/keyed'

type Action = Extract<Block, { kind: 'action' }>

/** The reply in order, tool calls that follow one another sharing one box. */
export function Reply({ blocks }: { blocks: Block[] }) {
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
export function CopyReply({ blocks }: { blocks: Block[] }) {
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
