// The paths a terminal shows, found on its cells as they are in chat; a wide character, as Chinese
// is, fills two cells, so where a path is on the screen is counted by the cell, not the character.

import type { Mention, Piece } from './files/mentions'

/** A cell as xterm has it: `width` 0 for the second half of a wide character, `chars` empty when
 * nothing was written there. */
export type Cell = { chars: string; width: number }
/** A cell's place, counted from 1 as xterm counts it. */
export type At = { x: number; y: number }
/** `end`: the last cell of the path, in it. */
export type TermLink = { mention: Mention; start: At; end: At }

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

/** The paths on one line: `rows` from the buffer's row `firstY`, the later ones those it ran on
 * into. */
export function lineLinks(rows: Cell[][], firstY: number, find: (text: string) => Piece[]): TermLink[] {
  // Each UTF-16 unit of the line's text, with the cell it is written in.
  const units = rows.flatMap((row, i) =>
    row.flatMap((cell, x) =>
      cell.width === 0
        ? []
        : (cell.chars || ' ').split('').map(unit => ({ unit, at: { x: x + 1, y: firstY + i } })),
    ),
  )
  const text = units.map(u => u.unit).join('')
  return find(text).reduce<{ from: number; links: TermLink[] }>(
    ({ from, links }, piece) => {
      if (typeof piece === 'string') return { from: from + piece.length, links }
      const start = units[from]?.at
      const end = units[from + piece.text.length - 1]?.at
      const link = start && end ? [{ mention: piece, start, end }] : []
      return { from: from + piece.text.length, links: [...links, ...link] }
    },
    { from: 0, links: [] },
  ).links
}
