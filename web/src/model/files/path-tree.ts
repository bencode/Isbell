// Root-relative file paths, such as a search finds, as the tree they sit in.

export type PathNode = {
  /** A file's name, or a folder's; or a chain of folders shown as one, such as `web/src/features`. */
  name: string
  /** Relative to the root: the file, or the deepest folder of a chain. */
  rel: string
  kind: 'dir' | 'file'
  /** Empty for a file. */
  children: PathNode[]
}

/** A folder's entries by name: a file is null. */
type Folder = Map<string, Folder | null>

/** Files as a tree: folders before files, each by name; a folder whose only child is a folder is
 * shown as one row with it. */
export function pathTree(paths: string[]): PathNode[] {
  const root: Folder = new Map()
  for (const path of paths) {
    const parts = path.split('/')
    const name = parts.pop() ?? path
    const folder = parts.reduce((at, part) => {
      const next = at.get(part) ?? new Map()
      at.set(part, next)
      return next
    }, root)
    folder.set(name, null)
  }
  return nodesOf(root, '')
}

const nodesOf = (folder: Folder, base: string): PathNode[] =>
  [...folder]
    .map(([name, sub]): PathNode => {
      const rel = base ? `${base}/${name}` : name
      return sub ? compact({ name, rel, kind: 'dir', children: nodesOf(sub, rel) }) : file(name, rel)
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))

const file = (name: string, rel: string): PathNode => ({ name, rel, kind: 'file', children: [] })

// Its child was compacted first, so a chain of any length folds into one.
const compact = (dir: PathNode): PathNode => {
  const [only, ...rest] = dir.children
  return only?.kind === 'dir' && !rest.length ? { ...only, name: `${dir.name}/${only.name}` } : dir
}

export type Part = { text: string; hit: boolean /** Where it starts in the text. */; at: number }

/** `text` cut where `query` occurs, ignoring case, each part saying whether it matched. */
export function matchParts(text: string, query: string): Part[] {
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  const parts: Part[] = []
  let at = 0
  for (let i = needle ? haystack.indexOf(needle) : -1; i !== -1; i = haystack.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false, at })
    parts.push({ text: text.slice(i, i + needle.length), hit: true, at: i })
    at = i + needle.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false, at })
  return parts
}
