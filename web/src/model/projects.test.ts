import { describe, expect, test } from 'vitest'
import type { Shell } from './herdr'
import { deriveProjects, judgeAdd, lanes, needs } from './projects'
import type { MachineEntry } from './space'
import type { Agent } from './state'

const MID = '0123456789abcdef'

const machine = (agents: Agent[], online = true): MachineEntry => ({
  online,
  state: {
    machine: { id: MID, name: 'mac-mini', hostname: 'mac-mini.local', os: 'macos', version: '0.1.0' },
    boot: 1,
    rev: 1,
    herdr: { status: 'ready' },
    caps: { methods: [], agentKinds: ['codex'] },
    agents,
  },
})

const agent = (
  paneId: string,
  cwd: string,
  status: Agent['status'] = 'working',
  statusSince = 10,
): Agent => ({
  paneId,
  name: paneId,
  status,
  statusSince,
  cwd,
})

const shell = (paneId: string, cwd: string): Shell => ({ mid: MID, paneId, cwd })

describe('deriveProjects', () => {
  test('agents in a subdirectory belong to the outer project', () => {
    const projects = deriveProjects(
      [machine([agent('p1', '/Users/me/work/isbell'), agent('p2', '/Users/me/work/isbell/crates/')])],
      [],
      {},
    )
    expect(projects.map(p => [p.display, p.sessions.map(s => s.paneId)])).toEqual([
      ['~/work/isbell', ['p1', 'p2']],
    ])
  })

  test('a shell joins the project it sits in, or stands as its own', () => {
    const projects = deriveProjects(
      [machine([agent('p1', '/Users/me/work/isbell')])],
      [shell('s1', '/Users/me/work/isbell/web'), shell('s2', '/Users/me/work/new-tool')],
      {},
    )
    const shells = Object.fromEntries(projects.map(p => [p.name, p.shells.map(s => s.paneId)]))
    expect(shells).toEqual({ isbell: ['s1'], 'new-tool': ['s2'] })
  })

  test('neither a home directory nor a shell above a project swallows it', () => {
    const projects = deriveProjects(
      [machine([agent('p1', '/Users/me'), agent('p2', '/Users/me/work/isbell')])],
      [shell('s1', '/Users/me/work')],
      {},
    )
    expect(projects.map(p => p.display).sort()).toEqual(['~', '~/work', '~/work/isbell'])
  })

  test('a finished session is unread until looked at after it finished', () => {
    const entry = machine([agent('p1', '/srv/a', 'done', 50)])
    expect(deriveProjects([entry], [], {})[0]?.sessions[0]?.unread).toBe(true)
    expect(deriveProjects([entry], [], { [`${MID}/p1`]: 50 })[0]?.sessions[0]?.unread).toBe(false)
  })
})

test('needs lists blocked sessions first, then unread ones, newest first', () => {
  const projects = deriveProjects(
    [
      machine([
        agent('done-old', '/srv/a', 'done', 1),
        agent('blocked', '/srv/b', 'blocked', 2),
        agent('done-new', '/srv/c', 'done', 3),
        agent('working', '/srv/d', 'working', 4),
      ]),
    ],
    [],
    {},
  )
  expect(needs(projects).map(s => s.paneId)).toEqual(['blocked', 'done-new', 'done-old'])
})

test('the lanes hold who asks, who finished unseen and who works, the longest waiting first', () => {
  const projects = deriveProjects(
    [
      machine([
        agent('asks-late', '/srv/a', 'blocked', 5),
        agent('asks-early', '/srv/b', 'blocked', 2),
        agent('done', '/srv/c', 'done', 3),
        agent('seen', '/srv/c', 'done', 1),
        agent('works', '/srv/d', 'working', 4),
        agent('idle', '/srv/d', 'idle', 6),
        agent('unknown', '/srv/d', 'unknown', 7),
      ]),
    ],
    [],
    { [`${MID}/seen`]: 1 },
  )
  const ids = (lane: { session: { paneId: string } }[]) => lane.map(p => p.session.paneId)
  const { asking, finished, running } = lanes(projects)
  expect([ids(asking), ids(finished), ids(running)]).toEqual([
    ['asks-early', 'asks-late'],
    ['done'],
    ['works'],
  ])
})

describe('judgeAdd', () => {
  const projects = deriveProjects([machine([agent('p1', '/Users/me/work/isbell')])], [], {})

  test('the same directory, or one inside a project, opens that project', () => {
    expect(judgeAdd(projects, MID, '~/work/isbell/')).toMatchObject({ kind: 'open', inside: false })
    expect(judgeAdd(projects, MID, '/Users/me/work/isbell/crates')).toMatchObject({
      kind: 'open',
      inside: true,
    })
  })

  test('anything else is added; relative paths are refused', () => {
    expect(judgeAdd(projects, MID, '~/work/new-tool')).toEqual({
      kind: 'add',
      dir: '/Users/me/work/new-tool',
    })
    expect(judgeAdd(projects, MID, 'work/x').kind).toBe('bad')
    expect(judgeAdd(projects, MID, '  ').kind).toBe('none')
  })
})
