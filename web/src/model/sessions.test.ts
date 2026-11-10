import { expect, test } from 'vitest'
import {
  byDay,
  byPeriod,
  codexRecordFor,
  mergeMonths,
  mergeRecent,
  parseMonth,
  parseRecent,
  parseRoots,
  recordSources,
  resumeArgs,
  within,
} from './sessions'

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

test('what was asked is read without the marks around pasted text, even with the last cut short', () => {
  const read = (first: string) => parseMonth(JSON.stringify({ ...session, first }))[0]?.first
  expect(read('<pasted_content id="96b1"> add a batch action </pasted_content id="96b1">')).toBe(
    'add a batch action',
  )
  expect(read('<pasted_content id="96b1"> see the logs and </pasted_conte')).toBe('see the logs and')
  expect(read('is a < b true')).toBe('is a < b true')
})

test("a month's sessions are read line by line, the latest first", () => {
  const lines = [
    JSON.stringify(session),
    '{"agent": "codex", "id"',
    JSON.stringify({ ...session, id: 's2', started: 5 }),
  ]
  expect(parseMonth(`${lines.join('\n')}\n`).map(s => s.id)).toEqual(['s2', 's1'])
})

test('Claude Code, Codex and pi resume a session by its id; other agents are not resumed', () => {
  expect(resumeArgs('claude', 'id1')).toEqual(['--resume', 'id1'])
  expect(resumeArgs('codex', 'id1')).toEqual(['resume', 'id1'])
  expect(resumeArgs('pi', 'id1')).toEqual(['--tui-mode', 'regular', '--session', 'id1'])
  expect(resumeArgs('gemini', 'id1')).toBeUndefined()
  expect(resumeArgs('toString', 'id1')).toBeUndefined()
})

test("a project's records are its own, below it, its worktrees', and its repository's that ran in it", () => {
  const roots = {
    '/w/app': { key: 'app', updated: 1 },
    '/w/app/tools': { key: 'tools', updated: 1 },
    '/w/app.worktrees/fix': { key: 'fix', updated: 1 },
    '/w/apple': { key: 'apple', updated: 1 },
    '/w': { key: 'w', updated: 1 },
  }
  expect(recordSources(roots, '/w/app', ['/w/app.worktrees/fix'])).toEqual([
    { key: 'app' },
    { key: 'tools' },
    { key: 'fix' },
    { key: 'w', only: '/w/app' },
  ])
  const above = { key: 'w', only: '/w/app' }
  expect([within(above, '/w/app/web'), within(above, '/w/apple'), within({ key: 'app' }, '/x')]).toEqual([
    true,
    false,
    true,
  ])
})

test('sessions from several places are one list, each once as last updated, the last active first', () => {
  const a = { ...session, last: 'a', updated: 5 }
  const merged = mergeRecent([
    [a, { ...session, id: 's2', last: 'b', updated: 7 }],
    [{ ...a, last: 'older', updated: 3 }],
  ])
  expect(merged.map(s => [s.id, s.last])).toEqual([
    ['s2', 'b'],
    ['s1', 'a'],
  ])
  const months = mergeMonths(
    [[session, { ...session, id: 's3', started: 9 }], [session]],
    new Set(['claude/s3']),
  )
  expect(months.map(s => s.id)).toEqual(['s1'])
})

test('sessions are grouped by the local day, in the order given', () => {
  const day = (d: number, h: number) => new Date(2026, 10, d, h).getTime()
  const at = [day(7, 18), day(7, 9), day(6, 23), day(5, 1)]
  expect(byDay(at, t => t).map(run => run.length)).toEqual([2, 1, 1])
})

test('a codex pane runs the session last active in its directory since it started, not one another pane runs', () => {
  const at = (id: string, cwd: string, updated: number, agent = 'codex') => ({
    agent,
    id,
    cwd,
    first: 'x',
    last: 'x',
    started: 1,
    updated,
  })
  const latest = [
    at('before', '/srv/a', 90),
    at('elsewhere', '/srv/b', 300),
    at('claude', '/srv/a', 300, 'claude'),
    at('taken', '/srv/a', 250),
    at('older', '/srv/a', 150),
    at('newer', '/srv/a', 200),
  ]
  expect(codexRecordFor(latest, '/srv/a', 100, new Set(['taken']))).toBe('newer')
  expect(codexRecordFor(latest, '/srv/a', 260, new Set())).toBeUndefined()
})

test('sessions fall in today, yesterday, the rest of the week from Monday, then their month', () => {
  // A Wednesday.
  const now = new Date(2026, 10, 11, 10).getTime()
  const at = [
    new Date(2026, 10, 11, 9),
    new Date(2026, 10, 10, 20),
    new Date(2026, 10, 9, 8),
    new Date(2026, 10, 8, 23),
    new Date(2026, 10, 2, 9),
    new Date(2026, 9, 28, 9),
  ].map(d => d.getTime())
  expect(byPeriod(at, t => t, now).map(run => [run.period, run.items.length])).toEqual([
    [{ kind: 'today' }, 1],
    [{ kind: 'yesterday' }, 1],
    [{ kind: 'week' }, 1],
    [{ kind: 'month', year: 2026, month: 10 }, 2],
    [{ kind: 'month', year: 2026, month: 9 }, 1],
  ])
})
