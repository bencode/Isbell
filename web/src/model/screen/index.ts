// An agent's screen read as turns: what was asked, and what came back. Each kind of agent draws
// its screen its own way; its Grammar says how, and one parser reads them all. Whatever the
// parser does not recognise, it leaves to the screen text.

import { claude } from './claude'
import { codex } from './codex'
import type { Block, Grammar, Question, Reading, Turn } from './types'

const GRAMMARS = new Map<string, Grammar>([
  ['codex', codex],
  ['claude', claude],
])

/**
 * The screen of an agent of `kind` as turns, or null when the kind is unknown or the screen is not
 * recognised. While the agent is `running`, `text` is its visible screen and an unfinished last
 * turn is its live turn; otherwise the agent stopped without closing it (a declined question,
 * say), and it counts as a turn.
 */
export function parseScreen(kind: string | undefined, text: string, running: boolean): Reading | null {
  const grammar = kind === undefined ? undefined : GRAMMARS.get(kind)
  return grammar ? parse(grammar, text, running) : null
}

/**
 * Folds a new reading into the one before. A `whole` reading came with the session's history and
 * replaces it. Otherwise it is one screen: the turns it shows that are not yet known follow the
 * known ones, and what is happening now comes from it.
 */
export function mergeReading(prev: Reading | null, next: Reading, whole: boolean): Reading {
  if (whole || !prev) return next
  const known = new Set(prev.turns.map(turnKey))
  const footer = next.footer ?? prev.footer
  return {
    start: prev.start || next.start,
    turns: [...prev.turns, ...next.turns.filter(t => !known.has(turnKey(t)))],
    ...(next.live ? { live: next.live } : {}),
    ...(next.question ? { question: next.question } : {}),
    ...(footer ? { footer } : {}),
  }
}

/** The last `n` lines of a reply: each line of text, each list item, each tool call and its last output. */
export function tailLines(blocks: Block[], n: number): string[] {
  return blocks
    .flatMap(b => {
      if (b.kind === 'text') return b.text.split('\n').filter(l => l.trim())
      if (b.kind === 'list') return b.items
      const out = b.output.at(-1)
      return [`${b.verb} ${b.target}`, ...(out ? [`└ ${out}`] : [])]
    })
    .slice(-n)
}

const turnKey = (t: Turn) => [t.prompt, t.at ?? '', t.took ?? ''].join('\n')

type Item = { head: string; rest: string[] }
type Segment = {
  prompt?: string
  items: Item[]
  end?: { took?: string; at?: string }
  /** Only the end of its reply is on the screen. */
  partial?: boolean
}

function parse(g: Grammar, text: string, running: boolean): Reading | null {
  const screen = text.split('\n').map(l => l.trimEnd())
  const bottom = g.bottom(screen)
  if (!bottom) return null
  const lines = screen.slice(0, bottom.at).filter(l => !g.noise.some(n => n.test(l)))
  const first = lines.findIndex(l => g.prompt.test(l))
  const start = (first < 0 ? lines : lines.slice(0, first)).some(l => g.banner.test(l))
  const pinned = !!g.pinned && running && first >= 0 && lines.slice(0, first).every(l => !l)
  const segments = split(g, lines, first, start, pinned)

  const last = segments.at(-1)
  const live = running && last && !last.end ? last : undefined
  // A finished turn shown only in part was read whole before, or is lost from the screen.
  const turns = segments
    .filter(s => s !== live && s.prompt !== undefined && !s.partial)
    .map(s => toTurn(g, s))
  const question = bottom.ask && toQuestion(screen.slice(bottom.ask.from, bottom.ask.to))
  return {
    start,
    turns,
    ...(live ? { live: { ...promptOf(live), reply: blocks(g, live.items) } } : {}),
    ...(question ? { question } : {}),
    ...(bottom.footer ? { footer: bottom.footer } : {}),
  }
}

const promptOf = (s: Segment) => (s.prompt === undefined ? {} : { prompt: s.prompt })

/**
 * The lines as segments, one per prompt. Lines before the first prompt are the banner, or the end
 * of a turn whose prompt has scrolled off; only a screen with no prompt at all keeps them, as the
 * turn in progress. With the first prompt `pinned`, its turn is partial.
 */
function split(g: Grammar, lines: string[], first: number, start: boolean, pinned: boolean): Segment[] {
  if (first < 0) return start ? [] : [readItems(g, undefined, lines)]
  const starts = lines.flatMap((l, i) => (i >= first && g.prompt.test(l) ? [i] : []))
  return starts.map((from, n) => {
    const body = lines.slice(from, starts[n + 1] ?? lines.length)
    const partial = pinned && n === 0
    // A long prompt wraps onto the lines after it, up to a blank line or the reply; a pinned one
    // keeps to its line, with the reply right under it.
    const stop = partial ? 1 : body.findIndex((l, i) => i > 0 && (!l || g.item.test(l)))
    const asked = stop < 0 ? body : body.slice(0, stop)
    const prompt = [g.prompt.exec(asked[0] ?? '')?.[1] ?? '', ...asked.slice(1).map(dedent)].join('\n')
    const segment = readItems(g, prompt, body.slice(asked.length))
    return partial ? { ...segment, partial } : segment
  })
}

function readItems(g: Grammar, prompt: string | undefined, lines: string[]): Segment {
  const items: Item[] = []
  let end: Segment['end']
  for (const [i, line] of lines.entries()) {
    const closing = g.end.exec(line)
    if (closing) {
      end = timing(closing.groups)
      break
    }
    const head = g.item.exec(line)
    if (head) {
      items.push({ head: head[1] ?? '', rest: [] })
      if (g.stop?.test(line)) {
        end = {}
        break
      }
    } else if (g.summary?.test(line) && alone(g, lines, i)) items.push({ head: line.trim(), rest: [] })
    else {
      const current = items.at(-1)
      if (current) current.rest.push(line)
      else if (line) items.push({ head: '', rest: [line] })
    }
  }
  return { ...(prompt === undefined ? {} : { prompt }), items, ...(end ? { end } : {}) }
}

/** Line `i` is a paragraph of its own, or heads a tool call's output: not part of the reply's text. */
const alone = (g: Grammar, lines: string[], i: number) => {
  const next = lines[i + 1]
  return !lines[i - 1] && (!next || !!g.output?.test(next))
}

const timing = (groups: Record<string, string | undefined> | undefined) => ({
  ...(groups?.took ? { took: groups.took } : {}),
  ...(groups?.at ? { at: groups.at } : {}),
})

const toTurn = (g: Grammar, s: Segment): Turn => ({
  prompt: s.prompt ?? '',
  reply: blocks(g, s.items),
  ...s.end,
})

const blocks = (g: Grammar, items: Item[]): Block[] =>
  items.flatMap(item => {
    const action = g.action(item.head, trimBlank(item.rest))
    return action ? [action] : paragraphs([item.head, ...item.rest.map(dedent)])
  })

// A list item: a bullet, or a number such as "3.", then the item.
const LIST_ITEM = /^(?:[•\-*]|(\d+)\.)\s+(.*)$/

/** Paragraphs split at blank lines; one whose every line is a list item is a list. */
function paragraphs(lines: string[]): Block[] {
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

// A numbered option, maybe marked as chosen, maybe with its shortcut such as "(y)" or "(esc)".
const OPTION = /^(?:[›❯]\s+)?(\d+)\.\s+(.+?)(?:\s\((?:[a-z]|esc)\))?$/

function toQuestion(region: string[]): Question | undefined {
  const lines = region.map(l => l.trim()).filter(Boolean)
  const options = lines.flatMap(l => {
    const m = OPTION.exec(l)
    return m ? [{ key: m[1] ?? '', label: m[2] ?? '' }] : []
  })
  const text = lines.find(l => l.endsWith('?') && !OPTION.test(l))
  if (!options.length || text === undefined) return undefined
  return { text, detail: lines.filter(l => l !== text && !OPTION.test(l)), options }
}

/** Reply lines sit two columns in, under the item's marker. */
const dedent = (line: string) => line.replace(/^ {1,2}/, '')

function trimBlank(lines: string[]): string[] {
  const from = lines.findIndex(Boolean)
  if (from < 0) return []
  const to = lines.length - [...lines].reverse().findIndex(Boolean)
  return lines.slice(from, to)
}
