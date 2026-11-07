// A record's JSON lines from a part of the file read: whole lines only, the cut one at the front
// kept to be joined with the part before it; and those that still stand once the user went back.

const NEWLINE = 10

/** `atStart`: the bytes begin the file, so their first line is whole. */
export function splitLines(bytes: Uint8Array, atStart: boolean): { lines: unknown[]; head?: Uint8Array } {
  const first = atStart ? 0 : bytes.indexOf(NEWLINE) + 1
  // No line ends here: all of it is the front of a line that began before.
  if (!atStart && first === 0) return { lines: [], head: bytes }
  const last = bytes.lastIndexOf(NEWLINE)
  // A line still being written is left for the next read.
  const body = last < first ? new Uint8Array(0) : bytes.subarray(first, last)
  const text = new TextDecoder().decode(body)
  const lines = text.split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      return [JSON.parse(line) as unknown]
    } catch (err) {
      console.warn('skipping an unreadable line of a session record', err)
      return []
    }
  })
  return atStart ? { lines } : { lines, head: bytes.subarray(0, first) }
}

type Line = Record<string, unknown>
/** A line's place in the conversation: what it follows, and whether it is something the user asked. */
type Node = { id: string; parent: string; asks: boolean }

/** The lines without those the user went back on: where two questions follow the same line, as when
 * the conversation is rewound and asked anew, the earlier question and what followed it are dropped.
 * Lines are in the order written, a line after the one it follows. */
export function standing(lines: Line[], nodeOf: (line: Line) => Node | undefined): Line[] {
  const nodes = lines.map(nodeOf)
  const asked = new Map<string, string>()
  const dropped = new Set<string>()
  for (const node of nodes) {
    if (!node?.asks || !node.parent) continue
    const was = asked.get(node.parent)
    if (was) dropped.add(was)
    asked.set(node.parent, node.id)
  }
  if (!dropped.size) return lines
  for (const node of nodes) if (node && dropped.has(node.parent)) dropped.add(node.id)
  return lines.filter((_, i) => {
    const node = nodes[i]
    return !node || !dropped.has(node.id)
  })
}

/** Where the lines read end: after the last newline, or where they began when there is none. */
export const endOf = (bytes: Uint8Array, from: number) => from + bytes.lastIndexOf(NEWLINE) + 1
