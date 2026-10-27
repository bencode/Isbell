import { expect, test } from 'vitest'
import { commonPrefix, completions, describeDir, frequentParents, splitTyped } from './complete'
import type { Entry } from './remote'

const dir = (name: string): Entry => ({ name, kind: 'dir' })

test('what is typed splits at its last slash, and completes to directories, best first', () => {
  expect(splitTyped('~/work/les')).toEqual({ dir: '~/work/', part: 'les' })
  expect(splitTyped('~')).toEqual({ dir: '~/', part: '' })
  expect(splitTyped('/')).toEqual({ dir: '/', part: '' })
  const entries = [
    dir('.config'),
    dir('Documents'),
    dir('lesscap'),
    dir('notes'),
    { name: 'less.txt', kind: 'file' } as Entry,
  ]
  expect(completions(entries, 'les')).toEqual(['lesscap'])
  expect(completions(entries, 'O')).toEqual(['Documents', 'notes'])
  expect(completions(entries, '')).toEqual(['Documents', 'lesscap', 'notes'])
  expect(completions(entries, '.c')).toEqual(['.config'])
})

test('Tab completes what the names share, and the usual parents come first', () => {
  expect(commonPrefix(['lesscap', 'Lessons'])).toBe('less')
  expect(commonPrefix(['only'])).toBe('only')
  expect(commonPrefix([])).toBe('')
  const paths = ['~/work/a', '~/apps/e', '~/work/b', '~/code/c', '~/x', '~/code/d']
  expect(frequentParents(paths, 2)).toEqual(['~/code', '~/work'])
})

test('a listed directory says whether it is a git repository and how much it holds', () => {
  const listing = { entries: [dir('.git'), dir('src')], total: 23, truncated: false }
  expect(describeDir(listing)).toEqual({ git: true, total: 23 })
})
