// Claude Code's transcript (a JSON line per message part): what was asked, the replies, thinking
// and tool calls of the main conversation, the tools' results, and how long each turn took.

import { splitUploads } from '../files/uploads'
import { standing } from './lines'
import { editOf, isObject, targetOf } from './tools'
import type { Asked, Entry } from './types'

type Block = Record<string, unknown>

const blocksOf = (content: unknown): Block[] =>
  typeof content === 'string'
    ? [{ type: 'text', text: content }]
    : Array.isArray(content)
      ? content.filter(isObject)
      : []

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** Text Claude Code adds of its own: a task's end, reminders, a command's output. */
const OWN =
  /^\s*<(task-notification|system-reminder|local-command-stdout|local-command-caveat|bash-stdout|bash-input)/
const COMMAND = /<command-name>(.*?)<\/command-name>/
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/

const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : blocksOf(content)
        .map(b => text(b.text))
        .join('\n')

/** What the user said in a line, if it is theirs. */
function asked(blocks: Block[]): Asked | 'interrupted' | undefined {
  const texts = blocks.filter(b => b.type === 'text').map(b => text(b.text))
  const data = blocks.flatMap(b => {
    const s = isObject(b.source) ? b.source : {}
    return b.type === 'image' && s.type === 'base64'
      ? [`data:${text(s.media_type)};base64,${text(s.data)}`]
      : []
  })
  const said = texts.join('\n')
  if (said.startsWith('[Request interrupted')) return 'interrupted'
  if (!said.trim() && !data.length) return undefined
  if (OWN.test(said)) return undefined
  const command = COMMAND.exec(said)
  const words = command ? `${command[1] ?? ''} ${ARGS.exec(said)?.[1] ?? ''}`.trim() : said
  return { ...splitUploads(words), data }
}

const timeOf = (line: Record<string, unknown>) => Date.parse(text(line.timestamp)) || 0

/** A main-conversation line's place: a question is a user line that is not a tool's result. */
function nodeOf(line: Record<string, unknown>) {
  if (typeof line.uuid !== 'string' || line.isSidechain) return undefined
  const message = isObject(line.message) ? line.message : {}
  const asks =
    line.type === 'user' && !line.isMeta && !blocksOf(message.content).some(b => b.type === 'tool_result')
  return { id: line.uuid, parent: text(line.parentUuid), asks }
}

export function claudeEntries(lines: unknown[]): Entry[] {
  let before = 0
  return standing(lines.filter(isObject), nodeOf).flatMap((line): Entry[] => {
    const at = timeOf(line)
    const was = before
    if (at) before = at
    if (line.type === 'system') {
      if (line.subtype === 'turn_duration' && typeof line.durationMs === 'number')
        return [{ kind: 'end', took: line.durationMs }]
      if (line.subtype === 'compact_boundary')
        return [{ kind: 'item', at, item: { kind: 'note', note: 'compacted' } }]
      return []
    }
    if (line.isSidechain || line.isMeta || line.isCompactSummary) return []
    const message = isObject(line.message) ? line.message : {}
    const blocks = blocksOf(message.content)
    if (line.type === 'user') {
      const results = blocks.flatMap((b): Entry[] =>
        b.type === 'tool_result'
          ? [
              {
                kind: 'result',
                id: text(b.tool_use_id),
                output: resultText(b.content),
                error: b.is_error === true,
              },
            ]
          : [],
      )
      if (results.length) return results
      const you = asked(blocks)
      if (you === 'interrupted') return [{ kind: 'item', at, item: { kind: 'note', note: 'interrupted' } }]
      return you ? [{ kind: 'you', id: text(line.uuid) || String(at), at, you }] : []
    }
    if (line.type !== 'assistant') return []
    const model: Entry[] =
      typeof message.model === 'string' && message.model !== '<synthetic>'
        ? [{ kind: 'model', model: message.model }]
        : []
    return [
      ...model,
      ...blocks.flatMap((b): Entry[] => {
        if (b.type === 'text' && text(b.text).trim())
          return [{ kind: 'item', at, item: { kind: 'text', text: text(b.text), markdown: true } }]
        if (b.type === 'thinking' && text(b.thinking).trim())
          return [
            {
              kind: 'item',
              at,
              item: {
                kind: 'thinking',
                text: text(b.thinking),
                ...(was && at > was ? { ms: at - was } : {}),
              },
            },
          ]
        if (b.type !== 'tool_use') return []
        const name = text(b.name)
        const edit = editOf(name, b.input)
        return [
          {
            kind: 'item',
            at,
            item: {
              kind: 'tool',
              id: text(b.id),
              name,
              target: targetOf(name, b.input),
              error: false,
              done: false,
              ...(edit ? { edit } : {}),
            },
          },
        ]
      }),
    ]
  })
}
