// The wheel, for an agent that keeps its own history. herdr streams only the screen, and not the
// modes a program asks for, so xterm has nothing to scroll and never reports the wheel. It is sent
// here as the agent would have had it from a terminal.

const SGR_UP = 64
const SGR_DOWN = 65

/** `left`: what was turned short of a notch. A trackpad sends many small deltas that only add up
 * to a line together. `cell`: a row's height in pixels. */
export function turnWheel(
  left: number,
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
  cell: number,
  rows: number,
): { notches: number; left: number } {
  const total = left + event.deltaY * ([1, cell, cell * rows][event.deltaMode] ?? 1)
  const notches = Math.trunc(total / cell)
  return { notches, left: total - notches * cell }
}

/** An SGR mouse report per notch; `notches` below zero scroll up. `col` and `row` count from 1. */
export const wheelReport = (notches: number, col: number, row: number): string =>
  `\x1b[<${notches < 0 ? SGR_UP : SGR_DOWN};${col};${row}M`.repeat(Math.abs(notches))

/** The cell under a point in a terminal of the given box and size. */
export function cellAt(
  point: { x: number; y: number },
  box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  size: { cols: number; rows: number },
): { col: number; row: number } {
  const at = (offset: number, span: number, cells: number) =>
    Math.min(cells, Math.max(1, Math.ceil((offset / span) * cells)))
  return {
    col: at(point.x - box.left, box.width, size.cols),
    row: at(point.y - box.top, box.height, size.rows),
  }
}
