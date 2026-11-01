// How pi (1.4) draws its screen, which only its colors tell apart: what was asked on a background
// of its own (userMessageBg), each tool call in a box of another (grey while it runs, green when it
// succeeded, red when it failed) under a title such as "$ ls -la" or "read README", its reply on
// none, and its thinking in italics; every line one column in. The input box sits between two
// rules at the bottom, the upper one carrying "⠏ Working" while it works, and the model is at the
// end of the last line under them. Isbell starts pi for a chat in its regular mode, which leaves the
// conversation in the terminal's history; in its default full screen, only the screen is there.

import { type Rgb, type StyledLine, styledLines } from './ansi'
import { paragraphs, type Segment, settle } from './turns'
import type { Block, Reading } from './types'

// The backgrounds of its dark and light themes: what was asked, and an extension's own message.
const PROMPT_BG: Rgb[] = [
  [33, 59, 73],
  [223, 231, 236],
]
const NOTE_BG: Rgb[] = [
  [58, 48, 85],
  [230, 228, 238],
]
const RULE = /^──.*─{20,}/
const BANNER = /escape interrupt · /
// "(provider) model • thinking" at the end of the line, after the context it has used "(auto)".
const MODEL = /\([^)]+\) ([^()]+)$/
// A tool's output folded to its last lines, and its time under it.
const FOLDED = /^\.\.\. \(\d+ earlier lines?, ctrl\+o to expand\)$/
const TIMED = /^(?:Took|Elapsed) \d/

type Run = { kind: 'prompt' | 'tool' | 'text'; bg?: Rgb; lines: string[] }

const near = (a: Rgb) => (b: Rgb) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 3)
const sameBg = (a: Rgb | undefined, b: Rgb | undefined) => (a && b ? near(a)(b) : a === b)
/** pi sets every line one column in. */
const unpad = (line: string) => line.replace(/^ /, '')

function kindOf({ bg }: StyledLine): Run['kind'] {
  if (!bg || NOTE_BG.some(near(bg))) return 'text'
  return PROMPT_BG.some(near(bg)) ? 'prompt' : 'tool'
}

/** The lines as runs of one kind, a box ending where its background does. */
const runsOf = (lines: StyledLine[]): Run[] =>
  lines.reduce<Run[]>((runs, line) => {
    const kind = kindOf(line)
    const bg = kind === 'text' ? undefined : line.bg
    const last = runs.at(-1)
    if (last && last.kind === kind && sameBg(last.bg, bg)) last.lines.push(line.text)
    else runs.push({ kind, ...(bg ? { bg } : {}), lines: [line.text] })
    return runs
  }, [])

/** A tool's box as a tool call: its title's first word, the rest of it, and the lines under it. */
function action(lines: string[]): Block | undefined {
  const [title, ...under] = lines.filter(l => l.trim()).map(unpad)
  if (!title) return undefined
  const [verb = '', ...target] = title.split(' ')
  const output = under.filter(l => !FOLDED.test(l.trim()) && !TIMED.test(l.trim()))
  return { kind: 'action', verb, target: target.join(' '), output }
}

const reply = (runs: Run[]): Block[] =>
  runs.flatMap(r => (r.kind === 'tool' ? (action(r.lines) ?? []) : paragraphs(r.lines.map(unpad))))

const askedIn = (run: Run) =>
  run.lines
    .filter(l => l.trim())
    .map(unpad)
    .join('\n')

/** Undefined when the screen does not look like pi's; otherwise the turns on it. */
export function readPi(ansi: string, running: boolean): Reading | null {
  const lines = styledLines(ansi)
  const rules = lines.flatMap((l, i) => (RULE.test(l.text) ? [i] : []))
  const [top, bottom] = rules.slice(-2)
  if (top === undefined || bottom === undefined) return null
  const model = MODEL.exec(
    lines
      .slice(bottom + 1)
      .map(l => l.text)
      .filter(l => l.trim())
      .at(-1) ?? '',
  )?.[1]
  const runs = runsOf(lines.slice(0, top).filter(l => !l.italic))
  const first = runs.findIndex(r => r.kind === 'prompt')
  const start = (first < 0 ? runs : runs.slice(0, first)).some(r => r.lines.some(l => BANNER.test(l)))
  const segments: Segment[] =
    first < 0
      ? start
        ? []
        : [{ reply: reply(runs) }]
      : runs.flatMap((r, i) => {
          if (i < first || r.kind !== 'prompt') return []
          const next = runs.findIndex((n, j) => j > i && n.kind === 'prompt')
          return [{ prompt: askedIn(r), reply: reply(runs.slice(i + 1, next < 0 ? runs.length : next)) }]
        })
  const { turns, live } = settle(segments, running)
  return { start, turns, ...(live ? { live } : {}), ...(model ? { footer: { model } } : {}) }
}
