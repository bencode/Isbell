// A screen as herdr reads it with its colors (`format: "ansi"`): lines of text in SGR sequences.
// Only what tells one kind of line from another is kept: the background a line is drawn on, and
// whether it is set in italics.

export type Rgb = readonly [number, number, number]

/** One line of a styled screen: its text, the background most of it is drawn on, and whether most
 * of its words are in italics. */
export type StyledLine = { text: string; bg?: Rgb; italic: boolean }

const ESC = '\u001b'
const BEL = '\u0007'

/** A run of text, or the parameters of an SGR sequence; other sequences (titles, prompt marks,
 * cursor moves) and carriage returns are dropped. */
type Token = { text: string } | { sgr: string }

function tokens(line: string): Token[] {
  const out: Token[] = []
  let text = ''
  let i = 0
  const flush = () => {
    if (text) out.push({ text })
    text = ''
  }
  while (i < line.length) {
    const ch = line[i] ?? ''
    if (ch !== ESC) {
      if (ch !== '\r') text += ch
      i += 1
    } else if (line[i + 1] === '[') {
      // CSI: parameters up to a final byte in @–~.
      let j = i + 2
      while (j < line.length && !/[@-~]/.test(line[j] ?? '')) j += 1
      if (line[j] === 'm') {
        flush()
        out.push({ sgr: line.slice(i + 2, j) })
      }
      i = j + 1
    } else if (line[i + 1] === ']') {
      // OSC: up to BEL, or ESC \.
      const bel = line.indexOf(BEL, i)
      const st = line.indexOf(`${ESC}\\`, i)
      const ends = [bel < 0 ? -1 : bel + 1, st < 0 ? -1 : st + 2].filter(e => e > 0)
      i = ends.length ? Math.min(...ends) : line.length
    } else i += 2
  }
  flush()
  return out
}

/** The screen's text, its styles taken off. */
export const stripStyles = (ansi: string): string =>
  ansi
    .split('\n')
    .map(line =>
      tokens(line)
        .map(t => ('text' in t ? t.text : ''))
        .join(''),
    )
    .join('\n')

type Pen = { bg?: Rgb; italic: boolean }

/** The pen after one SGR sequence. A background other than true colour counts as none: it cannot
 * be told from another. */
function apply(pen: Pen, params: string): Pen {
  const codes = params === '' ? [0] : params.split(';').map(Number)
  let next = pen
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0
    if (code === 0) next = { italic: false }
    else if (code === 3) next = { ...next, italic: true }
    else if (code === 23) next = { ...next, italic: false }
    else if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107))
      next = { italic: next.italic }
    else if (code === 38 || code === 48) {
      // A colour after 38 (foreground) or 48 (background): 2;r;g;b or 5;n.
      const rgb = codes[i + 1] === 2
      if (code === 48)
        next = rgb
          ? { ...next, bg: [codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0] }
          : { italic: next.italic }
      i += rgb ? 4 : 2
    }
  }
  return next
}

/** The most common of the values, if more than half of them have it. */
function most<T>(values: T[], key: (v: T) => string): T | undefined {
  const counts = values.reduce((m, v) => {
    const k = key(v)
    const had = m.get(k)
    return m.set(k, { value: v, n: (had?.n ?? 0) + 1 })
  }, new Map<string, { value: T; n: number }>())
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0]
  return top && top.n * 2 > values.length ? top.value : undefined
}

/** The line, read with the pen the line before left; and the pen it leaves. */
function readLine(line: string, pen: Pen): { line: StyledLine; pen: Pen } {
  const chars: { ch: string; pen: Pen }[] = []
  let at = pen
  for (const t of tokens(line)) {
    if ('sgr' in t) at = apply(at, t.sgr)
    else for (const ch of t.text) chars.push({ ch, pen: at })
  }
  const bg = most(chars, c => c.pen.bg?.join(',') ?? '')?.pen.bg
  const words = chars.filter(c => c.ch.trim())
  const italic = words.length > 0 && words.filter(c => c.pen.italic).length * 2 > words.length
  const text = chars
    .map(c => c.ch)
    .join('')
    .trimEnd()
  return { line: { text, ...(bg ? { bg } : {}), italic }, pen: at }
}

/** The screen's lines, each with the background and italics most of it is drawn in. */
export const styledLines = (ansi: string): StyledLine[] =>
  ansi.split('\n').reduce<{ lines: StyledLine[]; pen: Pen }>(
    (acc, raw) => {
      const read = readLine(raw, acc.pen)
      acc.lines.push(read.line)
      return { lines: acc.lines, pen: read.pen }
    },
    { lines: [], pen: { italic: false } },
  ).lines
