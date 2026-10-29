// The paths an agent mentions in what it says, found in the text so they can be opened. A word is a
// path only when it reads unmistakably as one, and only one leading into the project, or another of
// its worktrees, counts; whether the file is there is left to opening it.

import { resolveLink } from './paths'
import { type FilesRoot, rootHolding } from './worktrees'

/** `root`: the key of the root the path leads into; `rel`, where it leads in it. */
export type Mention = { text: string; root: string; rel: string; dir: boolean }
export type Piece = string | Mention

// What words are cut at, the separators kept: spaces, quotes, brackets and the punctuation around a
// path in English or Chinese.
const SEPARATOR = /([\s"'`()[\]{}<>,;，。；：、（）「」《》“”‘’]+)/
const TRAILING = /[.:!?]+$/
const LINE = /(?::\d+){1,2}$/
const EXTENSION = /\.[A-Za-z][A-Za-z\d]{0,7}$/
// A word without a '/' is a file only with an extension that is plainly one.
const KNOWN =
  /^[\w.-]*\w\.(?:tsx?|jsx?|mjs|cjs|json|mdx?|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|rb|php|sh|zsh|toml|ya?ml|lock|css|scss|html|sql|txt|csv|vue|svelte)$/
// Library names such as Node.js read as files otherwise.
const LIBRARY = /^[A-Z][a-z]+\.js$/

/** `text` cut into plain runs and the paths in it that lead into one of `roots`, as read from `cwd`. */
export function mentions(text: string, roots: FilesRoot[], cwd: string): Piece[] {
  return text
    .split(SEPARATOR)
    .flatMap(word => {
      const tail = TRAILING.exec(word)?.[0] ?? ''
      const body = word.slice(0, word.length - tail.length)
      const at = mentionOf(body, roots, cwd)
      return at ? [at, tail] : [word]
    })
    .reduce<Piece[]>((acc, piece) => {
      const last = acc.at(-1)
      if (typeof piece === 'string' && typeof last === 'string') acc[acc.length - 1] = last + piece
      else if (piece !== '') acc.push(piece)
      return acc
    }, [])
}

function mentionOf(text: string, roots: FilesRoot[], cwd: string): Mention | undefined {
  const path = text.replace(LINE, '')
  if (!looksLikePath(path)) return undefined
  const dir = path.endsWith('/')
  const at = resolve(path.replace(/\/+$/, ''), roots, cwd)
  return at?.rel ? { text, root: at.root.key, rel: at.rel, dir } : undefined
}

function looksLikePath(path: string) {
  if (!path || path.includes('://')) return false
  if (!path.includes('/')) return KNOWN.test(path) && !LIBRARY.test(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  return EXTENSION.test(name) || path.endsWith('/') || /^(?:\.{1,2}|~)?\//.test(path)
}

/** The root `path` leads into and where in it, or undefined when it leads outside them all. */
function resolve(path: string, roots: FilesRoot[], cwd: string) {
  if (path.startsWith('/')) return rootHolding(roots, path)
  if (path.startsWith('~/')) return rootHolding(roots, path, r => r.display)
  // From outside the roots, a relative path cannot be told to lead into one; nor above its own.
  const from = rootHolding(roots, cwd)
  if (!from) return undefined
  const link = resolveLink(from.rel ? `${from.rel}/_` : '_', path)
  return link.kind === 'file' ? { root: from.root, rel: link.rel } : undefined
}
