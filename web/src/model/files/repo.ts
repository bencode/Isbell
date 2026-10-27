// The git repository a directory is in, asked of its machine one `.git` at a time.

import type { Caller } from '../herdr'
import { CallError } from '../streams'
import { list } from './remote'

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

/** The root of the git repository that `dir` is in, on machine `mid`; undefined when it is in none. */
export async function repoRootOf(call: Caller, mid: string, dir: string): Promise<string | undefined> {
  const candidates = repoCandidates(dir)
  const held = await Promise.all(candidates.map(path => holdsGit(call, mid, path)))
  return candidates.find((_, i) => held[i])
}

/** Whether `dir` has a `.git`: a directory, or the file a worktree or a submodule has. */
async function holdsGit(call: Caller, mid: string, dir: string): Promise<boolean> {
  try {
    await list(call, mid, `${dir}/.git`)
    return true
  } catch (err) {
    if (err instanceof CallError && err.code === 'not_a_directory') return true
    if (err instanceof CallError && err.code === 'not_found') return false
    throw err
  }
}
