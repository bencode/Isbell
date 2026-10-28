import { describe, expect, test } from 'vitest'
import type { Shell } from './herdr'
import { deriveProjects, judgeDir, lanes, needs } from './projects'
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
  test('a pane belongs to the repository it is in, else to its own directory, whatever is around it', () => {
    const W = '/Users/me/work'
    const repos = { [`${MID}:${W}/isbell/web`]: `${W}/isbell`, [`${MID}:${W}/isbell/`]: `${W}/isbell` }
    const projects = deriveProjects(
      [machine([agent('p1', W), agent('p2', `${W}/isbell/`), agent('p3', `${W}/isbell/web`)])],
      [shell('s1', `${W}/isbell/web`), shell('s2', `${W}/notes/draft`)],
      {},
      repos,
    )
    expect(
      projects.map(p => [p.display, p.sessions.map(s => s.paneId), p.shells.map(s => s.paneId)]),
    ).toEqual([
      ['~/work/notes/draft', [], ['s2']],
      ['~/work/isbell', ['p2', 'p3'], ['s1']],
      ['~/work', ['p1'], []],
    ])
  })

  test('a finished session is unread until looked at after it finished', () => {
    const entry = machine([agent('p1', '/srv/a', 'done', 50)])
    expect(deriveProjects([entry], [], {}, {})[0]?.sessions[0]?.unread).toBe(true)
    expect(deriveProjects([entry], [], { [`${MID}/p1`]: 50 }, {})[0]?.sessions[0]?.unread).toBe(false)
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
    {},
  )
  expect(needs(projects).map(s => s.paneId)).toEqual(['blocked', 'done-new', 'done-old'])
})

test('needs leaves out the sessions on machines that are offline', () => {
  const projects = deriveProjects([machine([agent('blocked', '/srv/b', 'blocked', 2)], false)], [], {}, {})
  expect(needs(projects)).toEqual([])
})

const ids = (lane: { session: { paneId: string } }[]) => lane.map(p => p.session.paneId)

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
    {},
  )
  const { asking, finished, running, standing, offline } = lanes(projects)
  expect([ids(asking), ids(finished), ids(running)]).toEqual([
    ['asks-early', 'asks-late'],
    ['done'],
    ['works'],
  ])
  // The rest stand by, the latest first.
  expect(ids(standing)).toEqual(['unknown', 'idle', 'seen'])
  expect(offline).toEqual([])
})

test('every agent of an offline machine is offline, whatever it last reported', () => {
  const projects = deriveProjects(
    [machine([agent('works', '/srv/a', 'working', 1), agent('asks', '/srv/b', 'blocked', 2)], false)],
    [],
    {},
    {},
  )
  const { asking, running, standing, offline } = lanes(projects)
  expect([asking, running, standing].flat()).toEqual([])
  expect(ids(offline)).toEqual(['asks', 'works'])
})

test('a typed directory is a full path, with ~ as the home its projects show', () => {
  const projects = deriveProjects([machine([agent('p1', '/Users/me/work/isbell')])], [], {}, {})
  expect(judgeDir(projects, MID, '~/work/new-tool/')).toEqual({ kind: 'dir', dir: '/Users/me/work/new-tool' })
  expect(judgeDir(projects, MID, 'work/x').kind).toBe('bad')
  expect(judgeDir(projects, MID, '  ').kind).toBe('none')
})
