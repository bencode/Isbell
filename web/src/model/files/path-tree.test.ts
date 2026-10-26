import { expect, test } from 'vitest'
import { matchParts, pathTree } from './path-tree'

/** The tree as indented lines: `name` for a file, `name/` for a folder. */
const lines = (paths: string[]) => {
  const walk = (nodes: ReturnType<typeof pathTree>, depth: number): string[] =>
    nodes.flatMap(n => [
      `${'  '.repeat(depth)}${n.name}${n.kind === 'dir' ? '/' : ''}`,
      ...walk(n.children, depth + 1),
    ])
  return walk(pathTree(paths), 0)
}

test('found files group into folders, folders first, chains of lone folders in one row', () => {
  expect(
    lines([
      'web/src/main.tsx',
      'README.md',
      'priv/design/pc-files.html',
      'priv/design/call-paths.html',
      'priv/notes.md',
      'a/b/c/x.md',
    ]),
  ).toEqual([
    'a/b/c/',
    '  x.md',
    'priv/',
    '  design/',
    '    call-paths.html',
    '    pc-files.html',
    '  notes.md',
    'web/src/',
    '  main.tsx',
    'README.md',
  ])
  // A chain is reached by its deepest folder.
  expect(pathTree(['a/b/c/x.md'])[0]).toMatchObject({ name: 'a/b/c', rel: 'a/b/c' })
  expect(pathTree(['a/b/c/x.md'])[0]?.children[0]).toMatchObject({ name: 'x.md', rel: 'a/b/c/x.md' })
})

test('a name is cut where the query occurs, ignoring case', () => {
  expect(matchParts('Design-design.md', 'DESIGN')).toEqual([
    { text: 'Design', hit: true, at: 0 },
    { text: '-', hit: false, at: 6 },
    { text: 'design', hit: true, at: 7 },
    { text: '.md', hit: false, at: 13 },
  ])
  expect(matchParts('main.tsx', 'zzz')).toEqual([{ text: 'main.tsx', hit: false, at: 0 }])
})
