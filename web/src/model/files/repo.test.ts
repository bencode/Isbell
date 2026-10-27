import { expect, test } from 'vitest'
import type { Caller } from '../herdr'
import { CallError } from '../streams'
import { repoRootOf } from './repo'

test('a directory is in the deepest repository above it, never one at home or above', async () => {
  // A repository at Isbell, a worktree (a .git file) at wt, and a dotfiles repository at home.
  const gits: Record<string, 'dir' | 'file'> = {
    '/Users/me/.git': 'dir',
    '/Users/me/work/Isbell/.git': 'dir',
    '/Users/me/work/Isbell/wt/.git': 'file',
  }
  const asked: string[] = []
  const call: Caller = async (_mid, _m, p) => {
    const { path } = p as { path: string }
    asked.push(path)
    if (gits[path] === 'dir') return { entries: [], total: 0, truncated: false }
    throw new CallError(gits[path] === 'file' ? 'not_a_directory' : 'not_found', path)
  }
  expect(await repoRootOf(call, 'm', '/Users/me/work/Isbell/web/src')).toBe('/Users/me/work/Isbell')
  expect(await repoRootOf(call, 'm', '/Users/me/work/Isbell/wt/')).toBe('/Users/me/work/Isbell/wt')
  expect(await repoRootOf(call, 'm', '/Users/me/notes')).toBeUndefined()
  expect(asked).not.toContain('/Users/me/.git')
})
