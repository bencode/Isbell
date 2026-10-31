import { expect, test } from 'vitest'
import { parseMonth, parseRecent, parseRoots, resumeArgs } from './sessions'

const session = { agent: 'claude', id: 's1', cwd: '/srv/a', first: 'fix it', started: 1 }

test('records the hook left half written, or of another shape, are passed over', () => {
  expect(
    parseRoots('{"/srv/a": {"key": "srv-a-1", "updated": 2}, "rel": {"key": "x", "updated": 1},'),
  ).toEqual({})
  expect(
    parseRoots(
      '{"/srv/a": {"key": "srv-a-1", "updated": 2}, "rel": {"key": "x", "updated": 1}, "/b": {"key": ""}}',
    ),
  ).toEqual({ '/srv/a': { key: 'srv-a-1', updated: 2 } })
  const recent = [
    { ...session, last: 'and test', updated: 3 },
    { ...session, id: 's2' },
  ]
  expect(parseRecent(JSON.stringify(recent))).toEqual([recent[0]])
  expect(parseRecent('{}')).toEqual([])
})

test("a month's sessions are read line by line, the latest first", () => {
  const lines = [
    JSON.stringify(session),
    '{"agent": "codex", "id"',
    JSON.stringify({ ...session, id: 's2', started: 5 }),
  ]
  expect(parseMonth(`${lines.join('\n')}\n`).map(s => s.id)).toEqual(['s2', 's1'])
})

test('Claude Code and Codex resume a session by its id; other agents are not resumed', () => {
  expect(resumeArgs('claude', 'id1')).toEqual(['--resume', 'id1'])
  expect(resumeArgs('codex', 'id1')).toEqual(['resume', 'id1'])
  expect(resumeArgs('pi', 'id1')).toBeUndefined()
})
