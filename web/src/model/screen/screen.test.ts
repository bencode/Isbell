import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { mergeReading, parseScreen, tailLines } from './index'
import type { Reading } from './types'

// Screens recorded from real panes with `herdr agent read`: `recent-unwrapped` once the agent had
// finished (done), `visible` while it worked or asked.
const screen = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')
const read = (kind: string, name: string, running: boolean) => {
  const reading = parseScreen(kind, screen(name), running)
  if (!reading) throw new Error(`${name} was not recognised`)
  return reading
}
const kinds = (r: Reading, turn: number) => r.turns[turn]?.reply.map(b => b.kind)

describe('codex', () => {
  test('reads finished turns with their actions, lists and timing', () => {
    const r = read('codex', 'codex-done', false)
    expect(r.start).toBe(true)
    expect(r.turns.map(t => [t.took, t.at])).toEqual([
      ['7s', '19:30'],
      ['8s', '19:31'],
      ['5s', '19:32'],
      [undefined, undefined],
    ])
    expect(r.turns[1]?.prompt).toBe(
      '运行 python3 -c "import calc; print(calc.add(2, 3))" 看看结果，然后把 add 修好，再运行一次确认。',
    )
    expect(kinds(r, 1)).toEqual(['text', 'action', 'action', 'action', 'text', 'list'])
    expect(r.turns[1]?.reply[2]).toEqual({
      kind: 'action',
      verb: 'Edited',
      target: 'calc.py (+1 -1)',
      output: ['2 -    return a - b', '2 +    return a + b'],
    })
    // Code arrives as plain lines, its indentation kept.
    expect(r.turns[0]?.reply).toContainEqual({ kind: 'text', text: 'def add(a, b):\n    return a + b' })
    expect(r.live).toBeUndefined()
    expect(r.footer).toEqual({ model: 'GPT-5.6-Sol high', task: '检查 calc.py 并提出修正' })
  })

  test('an interrupted turn ends where codex says so', () => {
    const last = read('codex', 'codex-done', false).turns[3]
    expect(last?.reply.at(-1)).toEqual({
      kind: 'text',
      text: 'Conversation interrupted - use /feedback if something went wrong',
    })
  })

  test('while it works, the unfinished turn is live', () => {
    for (const name of ['codex-working', 'codex-streaming']) {
      const r = read('codex', name, true)
      expect(r.start).toBe(false)
      // The turn on top shows its prompt pinned over only the end of its reply, so it is left out.
      expect(r.turns).toEqual([])
      expect(r.live?.prompt).toMatch(/^运行 python3/)
      expect(r.live?.reply[1]).toMatchObject({ kind: 'action', verb: 'Ran', output: ['-1'] })
    }
  })

  test('a numbered list keeps where its numbers start', () => {
    const text = [
      '› list',
      '',
      '• Steps:',
      '',
      '  3. Install',
      '  4. Run',
      '',
      '  • Done',
      '  • Kept',
      '',
      '  Worked for 2s • 10:00',
      '',
      '› Ask Codex to do anything',
      '',
      '  GPT · ~/x',
    ].join('\n')
    expect(parseScreen('codex', text, false)?.turns[0]?.reply).toEqual([
      { kind: 'text', text: 'Steps:' },
      { kind: 'list', items: ['Install', 'Run'], start: 3 },
      { kind: 'list', items: ['Done', 'Kept'] },
    ])
  })

  test('an approval is a question whose options answer with their number', () => {
    const r = read('codex', 'codex-asking', true)
    expect(r.question).toEqual({
      text: 'Would you like to run the following command?',
      detail: [
        'Environment: local',
        'Reason: 是否允许在工作目录外创建 ~/isbell-scratch/n7-outside.txt？',
        '$ echo hello > ~/isbell-scratch/n7-outside.txt',
      ],
      options: [
        { key: '1', label: 'Yes, proceed' },
        {
          key: '2',
          label:
            "Yes, and don't ask again for commands that start with `echo hello > ~/isbell-scratch/n7-outside.txt`",
        },
        { key: '3', label: 'No, and tell Codex what to do differently' },
      ],
    })
    expect(r.live?.reply.at(-1)).toMatchObject({ kind: 'action', verb: 'Running' })
  })
})

describe('claude', () => {
  test('reads finished turns, tool calls and the summaries of the tools it ran', () => {
    const r = read('claude', 'claude-done', false)
    expect(r.start).toBe(true)
    expect(r.turns.map(t => t.took)).toEqual(['39s', '13s', undefined])
    expect(kinds(r, 0)).toEqual(['action', 'text', 'list', 'text', 'text', 'text', 'text'])
    expect(r.turns[0]?.reply[0]).toEqual({
      kind: 'action',
      verb: 'Thought for 26s',
      target: 'read 1 file, ran 1 shell command',
      output: [],
    })
    expect(r.turns[1]?.reply[1]).toMatchObject({ kind: 'action', verb: 'Update', target: 'calc.py' })
    expect(r.live).toBeUndefined()
  })

  test('while it works, the turn is live with what it is running', () => {
    const r = read('claude', 'claude-working', true)
    expect(r.turns).toEqual([])
    expect(r.live?.reply).toHaveLength(1)
    expect(r.live?.reply[0]).toMatchObject({ kind: 'action', verb: 'Thinking for 24s' })
  })

  test('just started, the spinner is dropped and a summary heading an item is an action', () => {
    const rule = '─'.repeat(40)
    const text = [
      '❯ 用 bash 运行 touch probe2.txt 创建一个空文件。',
      '',
      '⏺ Thinking for 7s, running 1 shell command…',
      '  ⎿  $ touch probe2.txt',
      '',
      '· Sprouting…',
      '',
      rule,
      '❯ ',
      rule,
    ].join('\n')
    expect(parseScreen('claude', text, true)?.live?.reply).toEqual([
      {
        kind: 'action',
        verb: 'Thinking for 7s',
        target: 'running 1 shell command',
        output: ['$ touch probe2.txt'],
      },
    ])
  })

  test('a reply line that wraps onto words like a summary is still the reply', () => {
    const rule = '─'.repeat(40)
    const text = [
      '❯ explain add',
      '',
      '⏺ The add function now',
      '  takes 2 arguments and returns their',
      '  sum.',
      '',
      '✻ Cooked for 3s',
      '',
      rule,
      '❯ ',
      rule,
    ].join('\n')
    expect(parseScreen('claude', text, false)?.turns[0]?.reply).toEqual([
      { kind: 'text', text: 'The add function now\ntakes 2 arguments and returns their\nsum.' },
    ])
  })

  test('a paragraph whose first line wraps onto words like a summary is still the reply', () => {
    const rule = '─'.repeat(40)
    const text = [
      '❯ fix it',
      '',
      '⏺ Done.',
      '',
      '  Fixed 2 bugs in the parser and added',
      '  tests for both.',
      '',
      '✻ Cooked for 3s',
      '',
      rule,
      '❯ ',
      rule,
    ].join('\n')
    expect(parseScreen('claude', text, false)?.turns[0]?.reply).toEqual([
      { kind: 'text', text: 'Done.' },
      { kind: 'text', text: 'Fixed 2 bugs in the parser and added\ntests for both.' },
    ])
  })

  test('a permission prompt is a question', () => {
    const r = read('claude', 'claude-asking', true)
    expect(r.question).toEqual({
      text: 'Do you want to proceed?',
      detail: ['Bash command', 'touch probe.txt', 'Create empty file probe.txt'],
      options: [
        { key: '1', label: 'Yes' },
        { key: '2', label: 'Yes, and always allow access to n7/ from this project' },
        { key: '3', label: 'No' },
      ],
    })
    // The turn whose prompt scrolled off is left out; the one after it reads in full.
    expect(r.turns.map(t => t.took)).toEqual(['13s'])
  })
})

test('a screen it does not recognise is left to the screen text', () => {
  expect(parseScreen('aider', screen('codex-done'), false)).toBeNull()
  expect(parseScreen(undefined, screen('codex-done'), false)).toBeNull()
  expect(parseScreen('codex', screen('claude-done'), false)).toBeNull()
  expect(parseScreen('claude', 'aider v0.92.1\n> /add calc.py\n', false)).toBeNull()
})

describe('mergeReading', () => {
  const done = read('claude', 'claude-done', false)
  // Shows the 13s turn that `done` has too, then the question.
  const asking = read('claude', 'claude-asking', true)

  test('one screen keeps the turns read before it, each once, and brings what happens now', () => {
    const merged = mergeReading(done, asking, false)
    expect(merged.turns).toEqual(done.turns)
    expect(merged.live).toEqual(asking.live)
    expect(merged.question).toEqual(asking.question)
    expect(merged.start).toBe(true)
  })

  test('a reading with history replaces what was known', () => {
    expect(mergeReading(asking, done, true)).toBe(done)
  })
})

test('the tail of a reply is its last lines, a tool call with its last output', () => {
  const lines = tailLines(
    [
      { kind: 'text', text: 'Looking at the relay.\n\nFirst the config.' },
      { kind: 'list', items: ['bind on ::', 'keep 0.0.0.0'] },
      {
        kind: 'action',
        verb: 'Ran',
        target: 'stunclient isbell.fmap.dev',
        output: ['Binding test', 'Mapped address: 1.2.3.4'],
      },
    ],
    3,
  )
  expect(lines).toEqual(['keep 0.0.0.0', 'Ran stunclient isbell.fmap.dev', '└ Mapped address: 1.2.3.4'])
})
