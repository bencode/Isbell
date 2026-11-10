import { expect, it } from 'vitest'
import { mentions } from './files/mentions'
import type { FilesRoot } from './files/worktrees'
import { type Cell, lineAround, lineLinks } from './term-links'

const project: FilesRoot = {
  key: 'app-1',
  path: '/Users/me/work/app',
  display: '~/work/app',
  branch: 'main',
  own: true,
}
const find = (text: string) => mentions(text, [project], project.path)

/** A row as xterm lays it out: a wide character takes its cell and an empty one after it. */
const row = (text: string, cols: number): Cell[] => {
  const cells = [...text].flatMap(c =>
    /\p{Script=Han}/u.test(c)
      ? [
          { chars: c, width: 2 },
          { chars: '', width: 0 },
        ]
      : [{ chars: c, width: 1 }],
  )
  return [...cells, ...Array.from({ length: cols - cells.length }, () => ({ chars: '', width: 1 }))]
}

it('finds a path by the cells it fills, after wide characters and across the edge of the screen', () => {
  // 改好了 fills six cells; the path starts on the eighth and runs on after "web/s".
  const screen = [row('$ ls', 12), row('改好了 web/s', 12), row('rc/a.ts 了', 12)]
  const { rows, firstY } = lineAround(y => screen[y - 1], 3)
  expect(firstY).toBe(2)
  expect(lineLinks(rows, firstY, find)).toEqual([
    {
      mention: { text: 'web/src/a.ts', root: 'app-1', rel: 'web/src/a.ts', dir: false },
      start: { x: 8, y: 2 },
      end: { x: 7, y: 3 },
    },
  ])
})
