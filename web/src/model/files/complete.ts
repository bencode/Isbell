// Completing a directory path as it is typed, the way a shell's Tab does, over one directory's
// listing at a time.

import type { Entry, Listing } from './remote'

/** What is typed, split at its last '/': the directory to list and the part to complete. A bare
 * `~` is the home directory itself. */
export function splitTyped(typed: string): { dir: string; part: string } {
  const text = typed.trimStart() === '~' ? '~/' : typed.trimStart()
  const at = text.lastIndexOf('/')
  return { dir: text.slice(0, at + 1), part: text.slice(at + 1) }
}

/** Names of the directories among `entries` that `part` may complete to: those starting with it,
 * then those containing it, ignoring case. Dot directories only when `part` starts with '.'. */
export function completions(entries: Entry[], part: string): string[] {
  const wanted = part.toLowerCase()
  const dirs = entries
    .filter(e => e.kind === 'dir' && (part.startsWith('.') || !e.name.startsWith('.')))
    .map(e => e.name)
  const starts = (name: string) => name.toLowerCase().startsWith(wanted)
  return [
    ...dirs.filter(starts),
    ...dirs.filter(name => !starts(name) && name.toLowerCase().includes(wanted)),
  ]
}

/** The longest prefix the `names` share, ignoring case, as the first name spells it. */
export function commonPrefix(names: string[]): string {
  const [first = '', ...rest] = names
  let length = first.length
  for (const name of rest) {
    while (length > 0 && name.slice(0, length).toLowerCase() !== first.slice(0, length).toLowerCase())
      length--
  }
  return first.slice(0, length)
}

/** The parent directories of `paths` (as shown, with ~), the most common first, then by name, at
 * most `n`. The home and the root are left out; they are always at hand. */
export function frequentParents(paths: string[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (parent && parent !== '~') counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, n)
    .map(([parent]) => parent)
}

/** How a listed directory reads: whether it is a git repository, and how many entries it has. */
export const describeDir = (listing: Listing) => ({
  git: listing.entries.some(e => e.name === '.git'),
  total: listing.total,
})
