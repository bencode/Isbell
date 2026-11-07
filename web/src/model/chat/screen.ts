// A session read off the screen as turns, for when its record cannot be read: its formatting is
// gone, and so are times other than those the screen shows.

import { splitUploads } from '../files/uploads'
import type { Block, Reading, Turn } from '../screen/types'
import type { ChatItem, ChatTurn } from './types'

// "calc.py (+1 -1)": an edit's file, then lines added and removed.
const EDIT = /^(.*?)\s*\(\+(\d+) -(\d+)\)$/

const listText = (items: string[], start: number | undefined) =>
  items.map((item, i) => `${start === undefined ? '-' : `${start + i}.`} ${item}`).join('\n')

function itemOf(block: Block, i: number): ChatItem {
  if (block.kind === 'text') return { kind: 'text', text: block.text, markdown: false }
  if (block.kind === 'list')
    return { kind: 'text', text: listText(block.items, block.start), markdown: false }
  // A call such as Explored names its targets in its output.
  const target = block.target || block.output[0] || ''
  const edit = EDIT.exec(target)
  return {
    kind: 'tool',
    id: `${i}`,
    name: block.verb,
    target: edit?.[1] ?? target,
    ...(block.output.length ? { output: block.output.join('\n') } : {}),
    ...(edit ? { edit: { add: Number(edit[2]), del: Number(edit[3]) } } : {}),
    error: false,
    done: true,
  }
}

const turnOf = (turn: Pick<Turn, 'reply' | 'took' | 'at'> & { prompt?: string }, id: string): ChatTurn => ({
  id,
  ...(turn.prompt === undefined ? {} : { you: { ...splitUploads(turn.prompt), data: [] } }),
  at: 0,
  ...(turn.took || turn.at ? { when: [turn.at, turn.took].filter(Boolean).join(' · ') } : {}),
  items: turn.reply.map(itemOf),
})

/** The turns on the screen, then the one still going. */
export const fromScreen = (reading: Reading): ChatTurn[] => [
  ...reading.turns.map(turn => turnOf(turn, [turn.prompt, turn.at, turn.took].join('\n'))),
  ...(reading.live ? [turnOf(reading.live, 'live')] : []),
]
