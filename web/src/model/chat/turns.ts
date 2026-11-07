// A record's entries told into turns: each question starts one, and a tool's result goes to the
// call it answers.

import { claudeEntries } from './claude'
import { codexEntries } from './codex'
import { piEntries } from './pi'
import type { ChatTurn, Entry, ToolItem } from './types'

const READERS: Readonly<Record<string, (lines: unknown[]) => Entry[]>> = {
  claude: claudeEntries,
  codex: codexEntries,
  pi: piEntries,
}

/** Whether the chat can be read from this kind of agent's record. */
export const readsRecord = (kind: string | undefined) => kind !== undefined && kind in READERS

export const entriesOf = (kind: string, lines: unknown[]): Entry[] => READERS[kind]?.(lines) ?? []

/** What comes before the first question is the session's opening, or the end of a turn whose start
 * is not read yet: a turn with nothing asked. */
export function turnsOf(entries: Entry[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  const tools = new Map<string, { turn: number; at: number }>()
  let model: string | undefined
  for (const e of entries) {
    if (e.kind === 'model') {
      model = e.model
      const last = turns.at(-1)
      if (last && !last.model) last.model = model
    } else if (e.kind === 'you') {
      turns.push({ id: e.id, you: e.you, at: e.at, items: [], ...(model ? { model } : {}) })
    } else if (e.kind === 'item') {
      if (!turns.length) turns.push({ id: 'start', at: e.at, items: [], ...(model ? { model } : {}) })
      const turn = turns.length - 1
      const items = turns[turn]?.items
      if (e.item.kind === 'tool') tools.set(e.item.id, { turn, at: items?.length ?? 0 })
      items?.push(e.item)
    } else if (e.kind === 'result') {
      const where = tools.get(e.id)
      const tool = where && turns[where.turn]?.items[where.at]
      if (where && tool?.kind === 'tool') {
        const done: ToolItem = {
          ...tool,
          error: tool.error || e.error,
          done: true,
          ...(e.output ? { output: e.output } : {}),
        }
        turns[where.turn]?.items.splice(where.at, 1, done)
      }
    } else {
      const last = turns.at(-1)
      if (last && e.took !== undefined) last.took = e.took
    }
  }
  return turns
}
