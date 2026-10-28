// The paths an agent mentions in what it says, found in the text so they can be opened. A word is a
// path only when it reads unmistakably as one, and only one leading into the project counts; whether
// the file is there is left to opening it.

import type { Project } from '../projects'
import { relative, resolveLink } from './paths'

export type Mention = { text: string; rel: string; dir: boolean }
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

/** `text` cut into plain runs and the paths in it that lead into `project`, as read from `cwd`. */
export function mentions(text: string, project: Pick<Project, 'path' | 'display'>, cwd: string): Piece[] {
  return text
    .split(SEPARATOR)
    .flatMap(word => {
      const tail = TRAILING.exec(word)?.[0] ?? ''
      const body = word.slice(0, word.length - tail.length)
      const at = mentionOf(body, project, cwd)
      return at ? [at, tail] : [word]
    })
    .reduce<Piece[]>((acc, piece) => {
      const last = acc.at(-1)
      if (typeof piece === 'string' && typeof last === 'string') acc[acc.length - 1] = last + piece
      else if (piece !== '') acc.push(piece)
      return acc
    }, [])
}

function mentionOf(text: string, project: Pick<Project, 'path' | 'display'>, cwd: string) {
  const path = text.replace(LINE, '')
  if (!looksLikePath(path)) return undefined
  const dir = path.endsWith('/')
  const rel = resolve(path.replace(/\/+$/, ''), project, cwd)
  return rel ? { text, rel, dir } : undefined
}

function looksLikePath(path: string) {
  if (!path || path.includes('://')) return false
  if (!path.includes('/')) return KNOWN.test(path) && !LIBRARY.test(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  return EXTENSION.test(name) || path.endsWith('/') || /^(?:\.{1,2}|~)?\//.test(path)
}

/** Where `path` leads under the project's root, or undefined when it leads outside it. */
function resolve(path: string, project: Pick<Project, 'path' | 'display'>, cwd: string) {
  if (path.startsWith('/')) return relative(project.path, path)
  if (path.startsWith('~/')) return relative(project.display, path)
  // From outside the project, a relative path cannot be told to lead into it.
  const from = relative(project.path, cwd)
  if (from === undefined) return undefined
  const link = resolveLink(from ? `${from}/_` : '_', path)
  return link.kind === 'file' ? link.rel : undefined
}
