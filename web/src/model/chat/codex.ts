// Codex's rollout: the items each turn completed (what was asked, what it said, the commands it
// ran, the files it changed), how each turn ended, and the model it ran on.

import { diffOf, isObject } from './tools'
import type { ChatItem, Entry } from './types'

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const fileOf = (path: string) => path.replace(/^file:\/\//, '')

/** A command's verb as Codex parses it: a read, a search, a listing, or a command run. */
function commandItem(id: string, it: Record<string, unknown>): ChatItem {
  const parsed = Array.isArray(it.parsed_cmd) ? it.parsed_cmd.filter(isObject) : []
  const one = parsed.length === 1 ? parsed[0] : undefined
  const command = Array.isArray(it.command) ? text(it.command.at(-1)) : text(it.command)
  const [name, target] =
    one?.type === 'read'
      ? ['Read', text(one.path) || text(one.cmd)]
      : one?.type === 'search'
        ? ['Search', text(one.cmd)]
        : one?.type === 'list_files'
          ? ['List', text(one.cmd)]
          : ['Bash', command]
  const output = text(it.aggregated_output)
  const code = it.exit_code
  return {
    kind: 'tool',
    id,
    name,
    target: target.split('\n')[0] ?? '',
    ...(output ? { output } : {}),
    error: typeof code === 'number' && code !== 0,
    done: true,
  }
}

function changeItems(id: string, changes: unknown): ChatItem[] {
  if (!isObject(changes)) return []
  return Object.entries(changes).map(([path, change], i): ChatItem => {
    const c = isObject(change) ? change : {}
    const edit =
      c.type === 'add'
        ? { add: text(c.content).split('\n').length, del: 0 }
        : c.type === 'update'
          ? diffOf(text(c.unified_diff))
          : { add: 0, del: 0 }
    return {
      kind: 'tool',
      id: `${id}/${i}`,
      name: c.type === 'add' ? 'Write' : 'Edit',
      target: fileOf(path),
      edit,
      error: false,
      done: true,
    }
  })
}

/** What each kind of completed item shows as; kinds not here (reasoning, which is kept secret, and
 * others) show nothing. */
const ITEMS: Readonly<Record<string, (it: Record<string, unknown>, id: string) => ChatItem[]>> = {
  AgentMessage: it => {
    const said = contentOf(it)
      .map(c => text(c.text))
      .join('')
    return said.trim() ? [{ kind: 'text', text: said, markdown: true }] : []
  },
  CommandExecution: (it, id) => [commandItem(id, it)],
  FileChange: (it, id) => changeItems(id, it.changes),
  McpToolCall: (it, id) => {
    const result =
      isObject(it.result) && Array.isArray(it.result.content) ? it.result.content.filter(isObject) : []
    const output = result.map(c => text(c.text)).join('\n')
    return [
      {
        kind: 'tool',
        id,
        name: text(it.tool),
        target: text(it.server),
        ...(output ? { output } : {}),
        error: it.status === 'failed',
        done: true,
      },
    ]
  },
  ImageView: (it, id) => [
    { kind: 'tool', id, name: 'View', target: fileOf(text(it.path)), error: false, done: true },
  ],
  Extension: (it, id) => [
    {
      kind: 'tool',
      id,
      name: it.kind === 'web.search' ? 'WebSearch' : text(it.kind),
      target: text(it.query),
      error: false,
      done: true,
    },
  ],
  ContextCompaction: () => [{ kind: 'note', note: 'compacted' }],
}

const contentOf = (it: Record<string, unknown>) =>
  Array.isArray(it.content) ? it.content.filter(isObject) : []

function completed(it: Record<string, unknown>, at: number): Entry[] {
  const id = text(it.id)
  if (it.type === 'UserMessage') {
    const content = contentOf(it)
    const words = content
      .filter(c => c.type === 'text')
      .map(c => text(c.text))
      .join('\n')
    const images = content.filter(c => c.type === 'local_image').map(c => text(c.path))
    return words.trim() || images.length
      ? [{ kind: 'you', id, at, you: { text: words, images, data: [] } }]
      : []
  }
  const read = ITEMS[text(it.type)]
  return read ? read(it, id).map(item => ({ kind: 'item', at, item })) : []
}

export function codexEntries(lines: unknown[]): Entry[] {
  return lines.filter(isObject).flatMap((line): Entry[] => {
    const p = isObject(line.payload) ? line.payload : {}
    if (line.type === 'turn_context')
      return typeof p.model === 'string'
        ? [{ kind: 'model', model: [p.model, text(p.effort)].filter(Boolean).join(' ') }]
        : []
    if (line.type !== 'event_msg') return []
    if (p.type === 'item_completed' && isObject(p.item)) {
      const at =
        typeof p.completed_at_ms === 'number' ? p.completed_at_ms : Date.parse(text(line.timestamp)) || 0
      return completed(p.item, at)
    }
    const took = typeof p.duration_ms === 'number' ? { took: p.duration_ms } : {}
    if (p.type === 'task_complete') return [{ kind: 'end', ...took }]
    if (p.type === 'turn_aborted')
      return [
        {
          kind: 'item',
          at: Date.parse(text(line.timestamp)) || 0,
          item: { kind: 'note', note: 'interrupted' },
        },
        { kind: 'end', ...took },
      ]
    return []
  })
}
