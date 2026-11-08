import { expect, test } from 'vitest'
import { type Caller, codexStarted, shells } from './herdr'

test("a pane's codex is its native binary, or the script node runs", () => {
  const shell = { pid: 1, name: 'zsh', argv: ['-zsh'], started: 1 }
  expect(codexStarted([shell, { pid: 2, name: 'codex', argv: ['codex', '--no-daemon'], started: 5 }])).toBe(5)
  const node = { pid: 3, name: 'node', argv: ['node', '/usr/local/bin/codex', 'resume'], started: 7 }
  expect(codexStarted([shell, node])).toBe(7)
  expect(codexStarted([shell, { ...node, argv: ['node', '/srv/vite.js'] }])).toBeUndefined()
})

test('a shell keeps the session an agent last reported running in it', async () => {
  const panes = [
    { pane_id: 'p1', cwd: '/w', tokens: { isbell_agent: 'pi', isbell_session: 's1' } },
    { pane_id: 'p2', cwd: '/w', agent: 'pi', tokens: { isbell_agent: 'pi', isbell_session: 's2' } },
    { pane_id: 'p3', cwd: '/w', tokens: { isbell_agent: 'pi' } },
  ]
  const call: Caller = async () => ({ snapshot: { panes } })
  expect(await shells(call, 'm')).toEqual([
    { mid: 'm', paneId: 'p1', cwd: '/w', ran: { agent: 'pi', id: 's1' } },
    { mid: 'm', paneId: 'p3', cwd: '/w' },
  ])
})
