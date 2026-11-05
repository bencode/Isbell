import { describe, expect, it } from 'vitest'
import { matchRoots, parseRootKey, rootKey, rootsOf } from './worktrees'

const project = { key: 'app-1', path: '/Users/me/work/app', display: '~/work/app' }

describe('worktrees', () => {
  it('addresses a branch in one segment and reads it back', () => {
    expect(rootKey('app-1', 'feat/x/y')).toBe('app-1@feat:x:y')
    expect(parseRootKey('app-1@feat:x:y')).toEqual({ project: 'app-1', branch: 'feat/x/y' })
    expect(parseRootKey(rootKey('app-1', 'a@b'))).toEqual({ project: 'app-1', branch: 'a@b' })
    expect(parseRootKey('app-1')).toEqual({ project: 'app-1' })
  })

  it('puts the project first, then the other branches by name, leaving out a detached HEAD', () => {
    const roots = rootsOf(project, [
      { path: '/Users/me/work/app', branch: 'main', here: true },
      { path: '/tmp/loose', branch: null, here: false },
      { path: '/Users/me/work/app.wt/zed', branch: 'zed', here: false },
      { path: '/Users/me/work/app.wt/feat', branch: 'feat/x', here: false },
    ])
    expect(roots.map(r => [r.key, r.branch, r.display])).toEqual([
      ['app-1', 'main', '~/work/app'],
      ['app-1@feat:x', 'feat/x', '~/work/app.wt/feat'],
      ['app-1@zed', 'zed', '~/work/app.wt/zed'],
    ])
  })

  it('finds a worktree by its branch or its directory, in its order', () => {
    const roots = rootsOf(project, [
      { path: '/Users/me/work/app', branch: 'main', here: true },
      { path: '/Users/me/work/app-wt/preview', branch: 'zed', here: false },
      { path: '/Users/me/work/app-wt/x', branch: 'feat/Preview', here: false },
    ])
    expect(matchRoots(roots, ' preview ').map(r => r.branch)).toEqual(['feat/Preview', 'zed'])
    expect(matchRoots(roots, '').length).toBe(3)
    expect(matchRoots(roots, 'nothing')).toEqual([])
  })

  it('is the project alone where no worktrees are known', () => {
    expect(rootsOf(project, [])).toEqual([{ ...project, branch: null, own: true }])
  })
})
