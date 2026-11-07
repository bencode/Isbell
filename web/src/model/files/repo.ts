// The git repository a directory is in, asked of its machine one `.git` at a time.

import type { Caller } from '../herdr'
import { CallError } from '../streams'
import { list, worktrees } from './remote'

/** A home directory or above is never a project's root, even when it is a repository. */
export const isBroad = (path: string) =>
  path === '/' || path === '/root' || /^\/(?:Users|home)(?:\/[^/]+)?$/.test(path)

/** The directories from `dir` up that may be a repository's root, deepest first. A home and the
 * directories above it never are, so a dotfiles repository in ~ groups nothing. */
export const repoCandidates = (dir: string): string[] =>
  dir
    .replace(/\/+$/, '')
    .split('/')
    .map((_, i, parts) => parts.slice(0, parts.length - i).join('/'))
    .filter(path => path.startsWith('/') && !isBroad(path))

/** The root of the git repository that `dir` is in, on machine `mid`: its main checkout, for a
 * directory in a worktree; undefined when it is in none. */
export async function repoRootOf(call: Caller, mid: string, dir: string): Promise<string | undefined> {
  const candidates = repoCandidates(dir)
  const held = await Promise.all(candidates.map(path => gitAt(call, mid, path)))
  const at = held.findIndex(Boolean)
  const root = candidates[at]
  return root && held[at] === 'file' ? mainCheckout(call, mid, root) : root
}

/** What `dir` has for a `.git`: a directory, or the file a worktree or a submodule has. */
async function gitAt(call: Caller, mid: string, dir: string): Promise<'dir' | 'file' | undefined> {
  try {
    await list(call, mid, `${dir}/.git`)
    return 'dir'
  } catch (err) {
    if (err instanceof CallError && err.code === 'not_a_directory') return 'file'
    if (err instanceof CallError && err.code === 'not_found') return undefined
    throw err
  }
}

/** The first of a repository's worktrees is its main checkout. A machine that cannot say leaves the
 * worktree as a root of its own. */
async function mainCheckout(call: Caller, mid: string, root: string): Promise<string> {
  try {
    return (await worktrees(call, mid, root))[0]?.path ?? root
  } catch (err) {
    console.warn('could not find the main checkout of', root, err)
    return root
  }
}
