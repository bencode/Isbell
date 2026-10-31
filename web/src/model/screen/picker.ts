// A menu an agent draws in place of its input box, such as the one /model opens: a title, numbered
// items with a cursor on one and a mark on the current one, and a line of the keys it takes.
// Claude Code and Codex draw theirs alike, so one reader serves both.

export type PickerItem = { n: number; label: string; note: string; current: boolean }

export type Picker = {
  /** The title and the lines under it, above the items. */
  heading: string[]
  /** The items on the screen; a long menu shows a window of them. */
  items: PickerItem[]
  cursor?: number
  /** Items past the last shown, as "… +3 models" says; 0 when none. */
  more: number
  /** Claude Code's effort ("High"), changed with ←/→ in the same menu. */
  effort?: string
  /** The hint line split into keys: "Enter to set as default · s to use this session only". */
  keys: { key: string; label: string }[]
}

// "❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for…", "↓ 10. Opus 4.8", "› 3. High (current)".
const ITEM = /^\s*([❯›])?\s*[↑↓]?\s*(\d+)\.\s+(.*)$/
const CURRENT = /\s*(?:✔|\(current\))/
const MORE = /^\s*… \+(\d+) /
const EFFORT = /^\s*\S+ (\S+) effort\b/
const HINT = /\besc\b/i
const RULE = /^[▔─]{20,}$/

/** The menu at the bottom of the screen, or undefined when the screen shows none. */
export function readPicker(text: string): Picker | undefined {
  const lines = text.split('\n').map(l => l.trimEnd())
  const last = lastIndex(lines, l => ITEM.test(l))
  if (last < 0) return undefined
  const below = lines.slice(last + 1).filter(Boolean)
  // Below a menu's items come only its own lines; below a list in a reply, the input box.
  if (!below.every(l => MORE.test(l) || EFFORT.test(l) || HINT.test(l))) return undefined
  let first = last
  while (first > 0 && ITEM.test(lines[first - 1] ?? '')) first -= 1
  const rows = lines.slice(first, last + 1).flatMap(l => {
    const m = ITEM.exec(l)
    return m ? [m] : []
  })
  const cursor = rows.find(m => m[1])?.[2]
  if (cursor === undefined) return undefined
  const effort = below.map(l => EFFORT.exec(l)?.[1]).find(Boolean)
  const hint = below.find(l => HINT.test(l))
  return {
    heading: headingAbove(lines, first),
    items: rows.map(m => toItem(Number(m[2]), m[3] ?? '')),
    cursor: Number(cursor),
    more: Number(below.map(l => MORE.exec(l)?.[1]).find(Boolean) ?? 0),
    ...(effort ? { effort } : {}),
    keys: hint ? hint.trim().split(' · ').flatMap(toKey) : [],
  }
}

function toItem(n: number, rest: string): PickerItem {
  const [label = '', ...note] = rest.split(/\s{2,}/)
  return { n, label: label.replace(CURRENT, ''), note: note.join(' '), current: CURRENT.test(label) }
}

function toKey(part: string): { key: string; label: string }[] {
  const m = /^(\S+?)(?: to)? (.+)$/.exec(part)
  return m ? [{ key: m[1] ?? '', label: m[2] ?? '' }] : []
}

/** The lines over the items up to the menu's top rule, or up to a gap of blank lines. */
function headingAbove(lines: string[], first: number): string[] {
  const heading: string[] = []
  let blanks = 0
  for (let i = first - 1; i >= 0 && heading.length < 4 && blanks < 3; i -= 1) {
    const l = lines[i] ?? ''
    if (RULE.test(l)) break
    if (!l.trim()) blanks += 1
    else {
      blanks = 0
      heading.unshift(l.trim())
    }
  }
  return heading
}

function lastIndex(lines: string[], test: (l: string) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (test(lines[i] ?? '')) return i
  return -1
}
