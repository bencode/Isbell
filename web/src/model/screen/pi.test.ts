import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { parseScreen } from './index'

// Screens recorded from a real pi pane in its regular mode with `herdr pane read --format ansi`:
// `recent-unwrapped` once it had finished (done), and while it ran a command (working).
const screen = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')

test("pi's turns are read off its colors: what was asked, its tool calls, and its reply without its thinking", () => {
  const r = parseScreen('pi', screen('pi-done'), false)
  expect(r?.start).toBe(true)
  expect(r?.turns.map(t => t.prompt.split('\n')[0])).toEqual([
    'Run ls -la with the bash tool and tell me how many entries there are.',
    'Read src/math.js and list its exports as bullets.',
    'Read README.md and summarize it in one line.',
    'Run sleep 4 with the bash tool, then use the read tool on src/missing.js (it does not exist), then say in one',
  ])
  const said = r?.turns.flatMap(t => t.reply.flatMap(b => (b.kind === 'text' ? [b.text] : [])))
  expect(said?.some(t => t.includes('Let me verify with a command for count.'))).toBe(false)
  expect(r?.turns[1]?.reply.map(b => b.kind)).toEqual(['action', 'action', 'text', 'list', 'text'])
  expect(r?.turns[1]?.reply[3]).toEqual({
    kind: 'list',
    items: ['add — (a, b) => a + b', 'sub — (a, b) => a - b'],
  })
  // A failed call is a tool call too, its error under it; the time it took is not output.
  expect(r?.turns[3]?.reply.slice(0, 2)).toEqual([
    { kind: 'action', verb: '$', target: 'sleep 4 && echo "slept 4s" (timeout 20s)', output: ['slept 4s'] },
    {
      kind: 'action',
      verb: 'read',
      target: 'src/missing.js',
      output: ['ENOENT: no such file or directory, access', "'~/demo/src/missing.", "js'"],
    },
  ])
  expect(r?.footer).toEqual({ model: 'deepseek-v4.1-flash • high' })
})

test('while pi works, its last turn is live, the call it runs in it', () => {
  const r = parseScreen('pi', screen('pi-working'), true)
  expect(r?.turns).toHaveLength(3)
  expect(r?.live).toEqual({
    prompt:
      'Run sleep 4 with the bash tool, then use the read tool on src/missing.js (it does not exist), then say in one\nsentence what happened.',
    reply: [{ kind: 'action', verb: '$', target: 'sleep 4 && echo "slept 4s" (timeout 20s)', output: [] }],
  })
})
