// A pane's history comes a window at a time: the last lines, and pages further back. Windows that
// overlap join into one stretch of history.

// How many of the newer window's first lines must recur in the older one for the two to meet.
const MEET = 20

/**
 * Two windows of one pane's history joined: `older` reaches further back, `newer` ends at the
 * bottom. Where the first lines of `newer` last appear in `older`, `older` gives way to `newer`,
 * which drops what `older` had at the bottom then (its input box, say). Null when they do not
 * meet, such as when more came out in between than the windows share.
 */
export function stitch(older: string[], newer: string[]): string[] | null {
  const head = newer.slice(0, MEET)
  // Blank lines recur anywhere.
  if (!head.some(Boolean)) return null
  for (let at = older.length - head.length; at >= 0; at -= 1)
    if (head.every((line, i) => older[at + i] === line)) return [...older.slice(0, at), ...newer]
  return null
}
