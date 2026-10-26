import { expect, test } from 'vitest'
import { ancestors, join, relative, resolveLink } from './paths'

test('paths move between absolute and root-relative', () => {
  expect(join('/w/isbell/', 'docs/a.md')).toBe('/w/isbell/docs/a.md')
  expect(join('/w/isbell', '')).toBe('/w/isbell')
  expect(relative('/w/isbell', '/w/isbell/web/src')).toBe('web/src')
  expect(relative('/w/isbell', '/w/isbell')).toBe('')
  expect(relative('/w/isbell', '/w/isbell-two/x')).toBeUndefined()
  expect(ancestors('web/src/main.tsx')).toEqual(['web', 'web/src'])
  expect(ancestors('README.md')).toEqual([])
})

test('a link opens a file under the root, jumps, leaves for the web, or goes nowhere', () => {
  const from = 'docs/guide/intro.md'
  expect(resolveLink(from, 'setup.md#run')).toEqual({ kind: 'file', rel: 'docs/guide/setup.md' })
  expect(resolveLink(from, '../../README.md?plain')).toEqual({ kind: 'file', rel: 'README.md' })
  expect(resolveLink(from, './my%20notes.md')).toEqual({ kind: 'file', rel: 'docs/guide/my notes.md' })
  expect(resolveLink(from, '#the-end')).toEqual({ kind: 'anchor', id: 'the-end' })
  expect(resolveLink(from, 'https://example.com')).toEqual({ kind: 'external' })
  expect(resolveLink(from, '../../../outside.md')).toEqual({ kind: 'inert' })
  expect(resolveLink(from, '/etc/hosts')).toEqual({ kind: 'inert' })
  expect(resolveLink(from, 'javascript:alert(1)')).toEqual({ kind: 'inert' })
})
