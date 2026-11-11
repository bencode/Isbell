// The web addresses and paths a terminal shows, found on its cells, the paths as they are in chat;
// a wide character, as Chinese is, fills two cells, so where a link is on the screen is counted by
// the cell, not the character.

import type { Mention, Piece } from './files/mentions'

/** A cell as xterm has it: `width` 0 for the second half of a wide character, `chars` empty when
 * nothing was written there. */
export type Cell = { chars: string; width: number }
/** A cell's place, counted from 1 as xterm counts it. */
export type At = { x: number; y: number }
/** What a link on the screen opens. `url`: the address, without the blanks a row it ran on into
 * started with. */
export type Target =
  | { kind: 'url'; text: string; url: string }
  | { kind: 'path'; text: string; mention: Mention }
/** `end`: the last cell of the link, in it. */
export type TermLink = { target: Target; start: At; end: At }
/** How the paths in some text are found, where the project is known. */
export type FindPaths = (text: string) => Piece[]

// Stands for the blanks a row that runs on starts with. An agent such as Claude Code indents what it
// wraps, an address too long for a row among it: an address has no blanks, so it goes on past them;
// to a path they are a space, as a word ending at the edge may be followed by one.
const INDENT = '\u2063'
// A web address runs to a space, a quote, a bracket or the punctuation around it in Chinese.
const WEB_ADDRESS = /(https?:\/\/[^\s"'`<>()[\]{}，。；：、（）「」《》“”‘’]+)/
// Punctuation that ends a sentence rather than the address, and blanks it ran on into.
const TRAILING = /[.,:;!?\u2063]+$/

/** `text` cut into plain runs and what can be opened in it: web addresses, and in the runs between,
 * the paths `paths` finds. */
function targets(text: string, paths?: FindPaths): (string | Target)[] {
  const plain = (run: string): (string | Target)[] =>
    !paths
      ? [run]
      : paths(run.replaceAll(INDENT, ' ')).map(p =>
          typeof p === 'string' ? p : { kind: 'path', text: p.text, mention: p },
        )
  // Split with a group, the addresses fall at the odd places; each gives the punctuation after it
  // to the run that follows.
  const parts = text.split(WEB_ADDRESS)
  const tail = (i: number) => TRAILING.exec(parts[i] ?? '')?.[0] ?? ''
  return parts.flatMap((part, i) => {
    if (i % 2 === 0) return plain((i > 0 ? tail(i - 1) : '') + part)
    const address = part.slice(0, part.length - tail(i).length)
    return [{ kind: 'url' as const, text: address, url: address.replaceAll(INDENT, '') }]
  })
}

/** Whether a row runs on into the next: filled to its last cell, as a line too long for the width
 * is. herdr draws the screen row by row, so xterm never marks a row as wrapped. */
function runsOn(row: Cell[] | undefined) {
  const last = row?.at(-1)
  // The second half of a wide character fills it too.
  return !!last && (last.width === 0 || last.chars.trim() !== '')
}

/** The rows of the line row `y` is part of, from its first, `firstY`. `rowAt` reads a row, counted
 * from 1; undefined past the buffer. */
export function lineAround(rowAt: (y: number) => Cell[] | undefined, y: number) {
  let firstY = y
  while (firstY > 1 && runsOn(rowAt(firstY - 1))) firstY -= 1
  let lastY = y
  while (runsOn(rowAt(lastY)) && rowAt(lastY + 1)) lastY += 1
  const rows = Array.from({ length: lastY - firstY + 1 }, (_, i) => rowAt(firstY + i) ?? [])
  return { rows, firstY }
}

/** The links on one line: `rows` from the buffer's row `firstY`, the later ones those it ran on
 * into; the paths among them where `paths` is given. */
export function lineLinks(rows: Cell[][], firstY: number, paths?: FindPaths): TermLink[] {
  // Each UTF-16 unit of the line's text, with the cell it is written in.
  const units = rows.flatMap((row, i) => {
    const filled = row.findIndex(cell => cell.width === 0 || cell.chars.trim() !== '')
    const indent = i === 0 ? 0 : filled < 0 ? row.length : filled
    return row.flatMap((cell, x) =>
      cell.width === 0
        ? []
        : (x < indent ? INDENT : cell.chars || ' ')
            .split('')
            .map(unit => ({ unit, at: { x: x + 1, y: firstY + i } })),
    )
  })
  const text = units.map(u => u.unit).join('')
  return targets(text, paths).reduce<{ from: number; links: TermLink[] }>(
    ({ from, links }, piece) => {
      if (typeof piece === 'string') return { from: from + piece.length, links }
      const start = units[from]?.at
      const end = units[from + piece.text.length - 1]?.at
      const link = start && end ? [{ target: piece, start, end }] : []
      return { from: from + piece.text.length, links: [...links, ...link] }
    },
    { from: 0, links: [] },
  ).links
}
