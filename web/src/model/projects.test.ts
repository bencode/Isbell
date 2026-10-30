import { describe, expect, test } from 'vitest'
import type { Shell } from './herdr'
import {
  deriveProjects,
  judgeDir,
  lanes,
  needs,
  nextNeeding,
  projectKey,
  STALE_MS,
  splitStale,
} from './projects'
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

  test('an agent without a name in herdr is called by its kind and pane, and has none to go by', () => {
    const { name: _, ...unnamed } = agent('w1A:p1', '/srv/a')
    const [named, plain] =
      deriveProjects([machine([agent('w2:p1', '/srv/a'), { ...unnamed, kind: 'codex' }])], [], {}, {})[0]
        ?.sessions ?? []
    expect([named?.name, named?.herdrName]).toEqual(['w2:p1', 'w2:p1'])
    expect(plain?.name).toBe('codex · 1A')
    expect(plain).not.toHaveProperty('herdrName')
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
    [{ mid: MID, paneId: 'shell', cwd: '/srv/a' }],
    { [`${MID}/seen`]: 1 },
    {},
  )
  const { asking, finished, running, standing, offline, shells } = lanes(projects)
  expect([ids(asking), ids(finished), ids(running)]).toEqual([
    ['asks-early', 'asks-late'],
    ['done'],
    ['works'],
  ])
  // The rest stand by, the latest first.
  expect(ids(standing)).toEqual(['unknown', 'idle', 'seen'])
  expect(offline).toEqual([])
  expect(shells.map(p => p.shell.paneId)).toEqual(['shell'])
})

test('every agent of an offline machine is offline, whatever it last reported, and its shells are not shown', () => {
  const projects = deriveProjects(
    [machine([agent('works', '/srv/a', 'working', 1), agent('asks', '/srv/b', 'blocked', 2)], false)],
    [{ mid: MID, paneId: 'shell', cwd: '/srv/a' }],
    {},
    {},
  )
  const { asking, running, standing, offline, shells } = lanes(projects)
  expect([asking, running, standing, shells].flat()).toEqual([])
  expect(ids(offline)).toEqual(['asks', 'works'])
})

test('a typed directory is a full path, with ~ as the home its projects show', () => {
  const projects = deriveProjects([machine([agent('p1', '/Users/me/work/isbell')])], [], {}, {})
  expect(judgeDir(projects, MID, '~/work/new-tool/')).toEqual({ kind: 'dir', dir: '/Users/me/work/new-tool' })
  expect(judgeDir(projects, MID, 'work/x').kind).toBe('bad')
  expect(judgeDir(projects, MID, '  ').kind).toBe('none')
})

test('a project key stands in an address as it is, and tells apart projects of one name', () => {
  const keys = [
    projectKey(MID, '/Users/me/work/isbell'),
    projectKey(MID, '/Users/me/old/isbell'),
    projectKey('fedcba9876543210', '/Users/me/work/isbell'),
    projectKey(MID, '/Users/me/work/my app.v2'),
    projectKey(MID, '/'),
    projectKey(MID, '/Users/me/项目'),
  ]
  expect(keys.every(k => /^[A-Za-z\d-]+$/.test(k))).toBe(true)
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys[0]).toMatch(/^isbell-/)
  expect(keys[3]).toMatch(/^my-app-v2-/)
  expect(keys[4]).toMatch(/^[a-z\d]+$/)
})

test('agents standing by are put aside once still for a day', () => {
  const now = 10 * STALE_MS
  const projects = deriveProjects(
    [
      machine([
        agent('fresh', '/srv/a', 'idle', now - STALE_MS + 1),
        agent('still', '/srv/a', 'idle', now - STALE_MS),
      ]),
    ],
    [],
    {},
    {},
  )
  const { recent, stale } = splitStale(lanes(projects).standing, now)
  expect(recent.map(p => p.session.paneId)).toEqual(['fresh'])
  expect(stale.map(p => p.session.paneId)).toEqual(['still'])
})

test('the next agent to see to goes down who asks, then who finished, and around', () => {
  const l = lanes(
    deriveProjects(
      [
        machine([
          agent('done', '/srv/a', 'done', 1),
          agent('asks-new', '/srv/a', 'blocked', 3),
          agent('asks-old', '/srv/a', 'blocked', 2),
          agent('works', '/srv/a', 'working', 4),
        ]),
      ],
      [],
      {},
      {},
    ),
  )
  const after = (paneId?: string) => nextNeeding(l, paneId ? { mid: MID, paneId } : undefined)?.session.paneId
  expect(after()).toBe('asks-old')
  expect(after('asks-old')).toBe('asks-new')
  expect(after('asks-new')).toBe('done')
  expect(after('done')).toBe('asks-old')
  expect(after('works')).toBe('asks-old')
  expect(nextNeeding(lanes([]), undefined)).toBeUndefined()
})
