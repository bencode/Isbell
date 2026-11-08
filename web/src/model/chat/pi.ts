// pi's session file: its messages (what was asked, the replies with their thinking and tool calls,
// and the tools' results), each with the model it came from.

import { standing } from './lines'
import { editOf, isObject, targetOf } from './tools'
import type { Entry } from './types'

const text = (v: unknown) => (typeof v === 'string' ? v : '')

// pi's tools by Claude Code's names, as the hook reports them.
const TOOLS: Readonly<Record<string, string>> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  find: 'Glob',
}

/** pi names the file a tool works on `path`; Claude Code, `file_path`. */
const inputOf = (args: unknown) =>
  isObject(args) && 'path' in args ? { ...args, file_path: args.path } : args

/** An entry's place in pi's session tree, which `/tree` branches. */
function nodeOf(line: Record<string, unknown>) {
  if (typeof line.id !== 'string') return undefined
  const asks = line.type === 'message' && isObject(line.message) && line.message.role === 'user'
  return { id: line.id, parent: text(line.parentId), asks }
}

export function piEntries(lines: unknown[]): Entry[] {
  return standing(lines.filter(isObject), nodeOf).flatMap((line): Entry[] => {
    if (line.type !== 'message' || !isObject(line.message)) return []
    const m = line.message
    const at = typeof m.timestamp === 'number' ? m.timestamp : Date.parse(text(line.timestamp)) || 0
    const blocks = Array.isArray(m.content) ? m.content.filter(isObject) : []
    if (m.role === 'user') {
      const words = blocks
        .filter(b => b.type === 'text')
        .map(b => text(b.text))
        .join('\n')
      const data = blocks
        .filter(b => b.type === 'image')
        .map(b => `data:${text(b.mimeType)};base64,${text(b.data)}`)
      return words.trim() || data.length
        ? [{ kind: 'you', id: text(line.id) || String(at), at, you: { text: words, images: [], data } }]
        : []
    }
    if (m.role === 'toolResult')
      return [
        {
          kind: 'result',
          id: text(m.toolCallId),
          output: blocks.map(b => text(b.text)).join('\n'),
          error: m.isError === true,
        },
      ]
    if (m.role !== 'assistant') return []
    const model: Entry[] = typeof m.model === 'string' ? [{ kind: 'model', model: m.model }] : []
    const said = blocks.flatMap((b): Entry[] => {
      if (b.type === 'text' && text(b.text).trim())
        return [{ kind: 'item', at, item: { kind: 'text', text: text(b.text) } }]
      if (b.type === 'thinking' && text(b.thinking).trim())
        return [{ kind: 'item', at, item: { kind: 'thinking', text: text(b.thinking) } }]
      if (b.type !== 'toolCall') return []
      const name = TOOLS[text(b.name)] ?? text(b.name)
      const input = inputOf(b.arguments)
      const edit = editOf(name, input)
      return [
        {
          kind: 'item',
          at,
          item: {
            kind: 'tool',
            id: text(b.id),
            name,
            target: targetOf(name, input),
            error: false,
            done: false,
            ...(edit ? { edit } : {}),
          },
        },
      ]
    })
    const failed: Entry[] =
      m.stopReason === 'error'
        ? [{ kind: 'item', at, item: { kind: 'note', note: 'failed', text: text(m.errorMessage) } }]
        : m.stopReason === 'aborted'
          ? [{ kind: 'item', at, item: { kind: 'note', note: 'interrupted' } }]
          : []
    // A reply that called no tool ends the turn.
    const ends: Entry[] = m.stopReason === 'toolUse' ? [] : [{ kind: 'end' }]
    return [...model, ...said, ...failed, ...ends]
  })
}
