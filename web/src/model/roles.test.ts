import { describe, expect, test } from 'vitest'
import { clustered, type Member, type Placing, parseRoles, type Roles, roleOf, teams } from './roles'

const book: Roles = {
  roles: [
    { id: 1, name: '达芬奇' },
    { id: 2, name: '麦克斯韦', lead: 1 },
  ],
  sessions: [
    { role: 1, agent: 'claude', id: 'a' },
    { role: 2, agent: 'claude', id: 'b' },
    { role: 2, agent: 'pi', id: 'c' },
  ],
}

describe('parseRoles', () => {
  test('reads what the CLI writes, leaving what the page does not use', () => {
    const text = JSON.stringify({
      version: 1,
      last: 2,
      roles: book.roles,
      sessions: book.sessions.map(s => ({ ...s, dir: '/w', at: 1 })),
    })
    expect(parseRoles(text)?.roles).toEqual(book.roles)
  })

  test.each([
    ['not JSON', '{'],
    ['another version', '{"version":2,"roles":[],"sessions":[]}'],
    ['a role with no name', '{"version":1,"roles":[{"id":1}],"sessions":[]}'],
    ['no sessions', '{"version":1,"roles":[]}'],
  ])('%s is no roles', (_, text) => {
    expect(parseRoles(text)).toBeUndefined()
  })
})

test('a session has the role it took, with its lead by name', () => {
  expect(roleOf(book, { agent: 'pi', id: 'c' })).toEqual({ name: '麦克斯韦', lead: '达芬奇' })
  expect(roleOf(book, { agent: 'claude', id: 'a' })).toEqual({ name: '达芬奇' })
  expect(roleOf(book, { agent: 'codex', id: 'a' })).toBeUndefined()
})

describe('teams', () => {
  const m = (key: string, lane: Member['lane'], name?: string, lead?: string, machine = 'mac'): Member => ({
    key,
    machine,
    lane,
    ...(name ? { role: lead ? { name, lead } : { name } } : {}),
  })
  const byKey = (members: Member[]) => Object.fromEntries(teams(members).map(p => [p.key, p]))

  test('a lead and those reporting to it go under the most urgent lane of them, the lead on top', () => {
    const placed = byKey([
      m('lead', 'standing', 'Ada'),
      m('asks', 'asking', 'Bob', 'Ada'),
      m('works', 'running', 'Cy', 'Ada'),
      m('alone', 'running'),
    ])
    expect(placed.lead).toEqual({ key: 'lead', lane: 'asking', team: 'lead', depth: 0 })
    expect(placed.asks).toEqual({ key: 'asks', lane: 'asking', team: 'lead', depth: 1, under: 'lead' })
    expect(placed.works).toEqual({ key: 'works', lane: 'asking', team: 'lead', depth: 1, under: 'lead' })
    expect(placed.alone).toEqual({ key: 'alone', lane: 'running', team: 'alone', depth: 0 })
  })

  test('one level is set in: one led by a member comes in the team, after its own lead', () => {
    const placed = byKey([
      m('a', 'running', 'Ada'),
      m('b', 'running', 'Bob', 'ada'),
      m('c', 'asking', 'Cy', 'Bob'),
    ])
    expect(placed.c).toEqual({ key: 'c', lane: 'asking', team: 'a', depth: 1, under: 'b' })
    expect(placed.b).toEqual({ key: 'b', lane: 'asking', team: 'a', depth: 1, under: 'a' })
  })

  test('one whose lead runs no agent comes alone', () => {
    expect(byKey([m('b', 'running', 'Bob', 'Ada')]).b).toEqual({
      key: 'b',
      lane: 'running',
      team: 'b',
      depth: 0,
    })
  })

  test("a role is one machine's: the same names on another make a team of their own", () => {
    const placed = byKey([
      m('a1', 'running', 'Ada', undefined, 'mini'),
      m('b1', 'running', 'Bob', 'Ada', 'mini'),
      m('b2', 'asking', 'Bob', 'Ada', 'pro'),
    ])
    expect(placed.b1).toEqual({ key: 'b1', lane: 'running', team: 'a1', depth: 1, under: 'a1' })
    expect(placed.b2).toEqual({ key: 'b2', lane: 'asking', team: 'b2', depth: 0 })
    expect(placed.a1?.lane).toBe('running')
  })

  test('the lead comes first wherever its team was, each one after the one it reports to', () => {
    const placings = new Map<string, Placing>(
      teams([
        m('x', 'asking'),
        m('c', 'asking', 'Cy', 'Bob'),
        m('d', 'asking', 'Di', 'Ada'),
        m('b', 'running', 'Bob', 'Ada'),
        m('a', 'standing', 'Ada'),
      ]).map(p => [p.key, p]),
    )
    expect(clustered(['x', 'c', 'd', 'b', 'a'], placings)).toEqual(['x', 'a', 'd', 'b', 'c'])
  })
})
