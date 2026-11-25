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
  const m = (key: string, lane: Member['lane'], name?: string, lead?: string): Member => ({
    key,
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

  test('one level is set in: one led by a member comes in the team, saying its own lead', () => {
    const placed = byKey([
      m('a', 'running', 'Ada'),
      m('b', 'running', 'Bob', 'ada'),
      m('c', 'asking', 'Cy', 'Bob'),
    ])
    expect(placed.c).toEqual({ key: 'c', lane: 'asking', team: 'a', depth: 1, under: 'b', via: 'Bob' })
    expect(placed.b?.via).toBeUndefined()
  })

  test('one whose lead runs no agent comes alone, saying who its lead is', () => {
    expect(byKey([m('b', 'running', 'Bob', 'Ada')]).b).toEqual({
      key: 'b',
      lane: 'running',
      team: 'b',
      depth: 0,
      via: 'Ada',
    })
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
