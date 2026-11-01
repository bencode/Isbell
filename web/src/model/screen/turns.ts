// What every kind of agent's screen comes to once read: segments, one per prompt, made into turns
// and the one still going; and a reply's text made into paragraphs and lists.

import type { Block, Live, Turn } from './types'

/** A prompt and what came back under it, as far as the screen shows it. */
export type Segment = {
  prompt?: string
  reply: Block[]
  end?: { took?: string; at?: string }
  /** Only the end of its reply is on the screen. */
  partial?: boolean
}

/**
 * The segments as turns. While the agent is `running`, an unfinished last segment is its live
 * turn; otherwise the agent stopped without closing it (a declined question, say), and it counts as
 * a turn. One with nothing under its prompt yet was only just sent, and counts as none.
 */
export function settle(segments: Segment[], running: boolean): { turns: Turn[]; live?: Live } {
  const last = segments.at(-1)
  const open = last && !last.end ? last : undefined
  const live = running ? open : undefined
  // Read before the agent shows it is working on it; the next reading has it live.
  const sent = open && open.reply.length === 0 ? open : undefined
  // A finished turn shown only in part was read whole before, or is lost from the screen.
  const turns = segments
    .filter(s => s !== live && s !== sent && s.prompt !== undefined && !s.partial)
    .map(s => ({ prompt: s.prompt ?? '', reply: s.reply, ...s.end }))
  return {
    turns,
    ...(live
      ? { live: { ...(live.prompt === undefined ? {} : { prompt: live.prompt }), reply: live.reply } }
      : {}),
  }
}

// A list item: a bullet, or a number such as "3.", then the item.
const LIST_ITEM = /^(?:[•\-*]|(\d+)\.)\s+(.*)$/

/** Paragraphs split at blank lines; one whose every line is a list item is a list. */
export function paragraphs(lines: string[]): Block[] {
  const groups = lines.reduce<string[][]>(
    (acc, line) => {
      if (line) acc.at(-1)?.push(line)
      else acc.push([])
      return acc
    },
    [[]],
  )
  return groups.filter(p => p.length).map(p => toList(p) ?? { kind: 'text', text: p.join('\n') })
}

/** The paragraph as a list, numbered when every item is. */
function toList(p: string[]): Block | undefined {
  const matches = p.map(l => LIST_ITEM.exec(l))
  if (!matches.every(m => m)) return undefined
  const items = matches.map(m => m?.[2] ?? '')
  const numbers = matches.map(m => m?.[1])
  const start = numbers.every(n => n !== undefined) ? Number(numbers[0]) : undefined
  return { kind: 'list', items, ...(start === undefined ? {} : { start }) }
}
