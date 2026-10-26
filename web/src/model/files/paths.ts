// Paths in a project's files: absolute on the machine, or relative to the project's root with '/'
// between segments ('' is the root itself).

/** `rel` under the absolute `root`. */
export const join = (root: string, rel: string) => (rel ? `${root.replace(/\/+$/, '')}/${rel}` : root)

/** Where `abs` sits under `root`, or undefined when it is outside it. */
export function relative(root: string, abs: string): string | undefined {
  const base = root.replace(/\/+$/, '')
  if (abs === base) return ''
  return abs.startsWith(`${base}/`) ? abs.slice(base.length + 1) : undefined
}

/** The directories above `rel`, outermost first: `a/b/c` → `a`, `a/b`. */
export const ancestors = (rel: string): string[] =>
  rel
    .split('/')
    .slice(0, -1)
    .map((_, i, dirs) => dirs.slice(0, i + 1).join('/'))

export const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1)

/** What a link in a file does: jump within it, leave for the web, open another file, or nothing. */
export type Link =
  | { kind: 'anchor'; id: string }
  | { kind: 'external' }
  | { kind: 'file'; rel: string }
  | { kind: 'inert' }

const WEB = /^(https?|mailto):/i
const SCHEME = /^[a-z][a-z\d+.-]*:/i

/** `href` as written in the file at `fileRel`; a file link outside the root goes nowhere. */
export function resolveLink(fileRel: string, href: string): Link {
  if (href.startsWith('#')) return { kind: 'anchor', id: decode(href.slice(1)) }
  if (WEB.test(href)) return { kind: 'external' }
  if (!href || SCHEME.test(href) || href.startsWith('/')) return { kind: 'inert' }
  const target = decode(href.replace(/[?#].*$/, ''))
  const resolved: string[] = []
  for (const part of [...fileRel.split('/').slice(0, -1), ...target.split('/')]) {
    if (part === '..') {
      // Above the root.
      if (!resolved.pop()) return { kind: 'inert' }
    } else if (part && part !== '.') resolved.push(part)
  }
  return resolved.length ? { kind: 'file', rel: resolved.join('/') } : { kind: 'inert' }
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch (err) {
    // A stray '%' is meant literally.
    if (err instanceof URIError) return s
    throw err
  }
}
