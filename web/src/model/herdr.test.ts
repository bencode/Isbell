import { expect, test } from 'vitest'
import { codexStarted } from './herdr'

test("a pane's codex is its native binary, or the script node runs", () => {
  const shell = { pid: 1, name: 'zsh', argv: ['-zsh'], started: 1 }
  expect(codexStarted([shell, { pid: 2, name: 'codex', argv: ['codex', '--no-daemon'], started: 5 }])).toBe(5)
  const node = { pid: 3, name: 'node', argv: ['node', '/usr/local/bin/codex', 'resume'], started: 7 }
  expect(codexStarted([shell, node])).toBe(7)
  expect(codexStarted([shell, { ...node, argv: ['node', '/srv/vite.js'] }])).toBeUndefined()
})
