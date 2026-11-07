import { describe, expect, test } from 'vitest'
import {
  listedPaths,
  type ProjectConfig,
  parseProjects,
  projectActions,
  serializeProjects,
} from './project-config'
import type { Project } from './projects'
import type { MachineEntry } from './space'

const project = (path: string, panes: boolean) =>
  ({ path, sessions: [], shells: panes ? [{ paneId: 'p' }] : [] }) as unknown as Project

describe('parseProjects', () => {
  test('reads back what is written, in order', () => {
    const paths = ['/w/b', '/w/a']
    expect(parseProjects(serializeProjects(paths))).toEqual(paths)
  })

  test('a directory written with a slash at its end is the same directory', () => {
    expect(parseProjects('{"version":1,"projects":[{"path":"/w/a/"}]}')).toEqual(['/w/a'])
  })

  test.each([
    ['not JSON', '{'],
    ['JSON of no object', 'null'],
    ['another version', '{"version":2,"projects":[]}'],
    ['entries with no path', '{"version":1,"projects":[{"dir":"/w"}]}'],
    ['a path under ~', '{"version":1,"projects":[{"path":"~/w"}]}'],
    ['an empty path', '{"version":1,"projects":[{"path":""}]}'],
  ])('refuses %s', (_, text) => {
    expect(parseProjects(text)).toBeUndefined()
  })
})

describe('projectActions', () => {
  const MID = 'm'
  const machine = (herdr = 'ready', online = true, methods = ['isbell.file.write']) =>
    ({
      online,
      state: { machine: { id: MID }, herdr: { status: herdr }, caps: { methods } },
    }) as unknown as MachineEntry
  const listed: ProjectConfig = { state: 'listed', paths: ['/w/a'] }
  const missing: ProjectConfig = { state: 'missing' }
  const known = new Set([MID])
  const running = [project('/w/a', true)]
  const none = { adds: false, removes: false }

  test('a machine that lists its projects has them added to and removed from', () => {
    expect(projectActions(machine(), listed, new Set(), [])).toEqual({ adds: true, removes: true })
  })

  test('a machine starts from where something runs, never from a home directory', () => {
    const projects = [
      project('/w/a', true),
      project('/w/old', false),
      project('/Users/me', true),
      project('', true),
    ]
    expect(projectActions(machine(), missing, known, projects)).toEqual({ ...none, start: ['/w/a'] })
  })

  test.each([
    ['nothing running', []],
    ['panes only in its home', [project('/Users/me', true)]],
  ])('a machine with no file and %s takes a project by hand', (_, projects) => {
    expect(projectActions(machine(), missing, known, projects)).toEqual({ adds: true, removes: false })
  })

  test.each<[string, MachineEntry, ProjectConfig | undefined, ReadonlySet<string>]>([
    ['has no herdr ready, with panes last seen', machine('unavailable'), missing, known],
    ['has not said where its panes run', machine(), missing, new Set()],
    ['is offline', machine('ready', false), listed, known],
    ['cannot write', machine('ready', true, []), listed, known],
    ['has not been read', machine(), undefined, known],
    ['has a file it cannot read', machine(), { state: 'broken' }, known],
    ['could not be written to', machine(), { state: 'unwritable' }, known],
  ])('nothing is done to a machine that %s', (_, entry, config, shells) => {
    expect(projectActions(entry, config, shells, running)).toEqual(none)
  })
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
