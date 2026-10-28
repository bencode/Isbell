import { describe, expect, it } from 'vitest'
import { mentions } from './mentions'

const project = { path: '/Users/me/work/app', display: '~/work/app' }
const found = (text: string, cwd = project.path) =>
  mentions(text, project, cwd).flatMap(p => (typeof p === 'string' ? [] : [p.rel + (p.dir ? '/' : '')]))

describe('mentions', () => {
  it('finds paths with a directory and an extension, as written around them', () => {
    expect(found('Changed `web/src/model/projects.ts`, see docs/setup.md.')).toEqual([
      'web/src/model/projects.ts',
      'docs/setup.md',
    ])
    expect(found('改好了：web/src/a.ts 里的')).toEqual(['web/src/a.ts'])
  })

  it('keeps the text whole and leaves the line out of the path', () => {
    const pieces = mentions('at src/a.ts:12:3.', project, project.path)
    expect(pieces).toEqual(['at ', { text: 'src/a.ts:12:3', rel: 'src/a.ts', dir: false }, '.'])
  })

  it('reads relative paths from the agent directory, and none above the root or from outside it', () => {
    const cwd = `${project.path}/web`
    expect(found('./src/a.ts and ../README.md', cwd)).toEqual(['web/src/a.ts', 'README.md'])
    expect(found('../../other/x.ts', cwd)).toEqual([])
    expect(found('src/a.ts', '/Users/me/work/other')).toEqual([])
  })

  it('takes absolute paths inside the project only', () => {
    expect(found('/Users/me/work/app/src/a.ts and ~/work/app/b.md')).toEqual(['src/a.ts', 'b.md'])
    expect(found('/Users/me/work/other/a.ts and /etc/hosts')).toEqual([])
  })

  it('takes a bare name only with a plain file extension', () => {
    expect(found('Ran calc.py and edited package.json')).toEqual(['calc.py', 'package.json'])
    expect(found('isbell.fmap.dev runs 0.2.0 on Node.js, e.g. now')).toEqual([])
  })

  it('leaves out addresses and words joined by a slash', () => {
    expect(found('see https://isbell.fmap.dev/a.html; read/write and/or')).toEqual([])
  })

  it('marks a path ending in a slash as a directory', () => {
    expect(found('look in web/src/')).toEqual(['web/src/'])
  })
})
