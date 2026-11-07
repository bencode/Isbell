import { describe, expect, test } from 'vitest'
import { initialPaths, listedPaths, parseProjects, serializeProjects } from './project-config'
import type { Project } from './projects'

const project = (path: string, panes: boolean) =>
  ({ path, sessions: [], shells: panes ? [{ paneId: 'p' }] : [] }) as unknown as Project

describe('parseProjects', () => {
  test('reads back what is written, in order', () => {
    const paths = ['/w/b', '/w/a']
    expect(parseProjects(serializeProjects(paths))).toEqual(paths)
  })

  test.each([
    ['not JSON', '{'],
    ['JSON of no object', 'null'],
    ['another version', '{"version":2,"projects":[]}'],
    ['entries with no path', '{"version":1,"projects":[{"dir":"/w"}]}'],
  ])('refuses %s', (_, text) => {
    expect(parseProjects(text)).toBeUndefined()
  })
})

test('a machine starts from where something runs, never from a home directory', () => {
  const projects = [
    project('/w/a', true),
    project('/w/old', false),
    project('/Users/me', true),
    project('', true),
  ]
  expect(initialPaths(projects)).toEqual(['/w/a'])
})

describe('listedPaths', () => {
  const kept = { a: ['/kept'], b: ['/kept'], c: ['/kept'], d: ['/kept'] }

  test('what a machine says wins over what was kept; what it has not said stays kept', () => {
    const listed = listedPaths(
      { a: { state: 'listed', paths: ['/read'] }, b: { state: 'missing' }, c: { state: 'broken' } },
      kept,
    )
    expect(listed).toEqual({ a: ['/read'], d: ['/kept'] })
  })
})
