import { expect, test } from 'vitest'
import { entriesOf, turnsOf } from './turns'

const read = (kind: string, lines: unknown[]) => turnsOf(entriesOf(kind, lines))
const at = (s: number) => new Date(Date.UTC(2026, 10, 7, 10, 0, s)).toISOString()

test("Claude Code's turns: the user's words, thinking, replies and tools with their results", () => {
  const lines = [
    {
      type: 'assistant',
      timestamp: at(0),
      message: { content: [{ type: 'text', text: 'the end of a turn not read' }] },
    },
    {
      type: 'user',
      uuid: 'u0',
      parentUuid: 'a0',
      timestamp: at(1),
      message: { content: 'asked, then gone back on' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u0',
      timestamp: at(1),
      message: { content: [{ type: 'text', text: 'dropped' }] },
    },
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: 'a0',
      timestamp: at(1),
      message: { content: 'why does the outline not jump?' },
    },
    { type: 'user', isMeta: true, timestamp: at(1), message: { content: 'Caveat: …' } },
    {
      type: 'assistant',
      timestamp: at(7),
      message: { model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'slugs differ' }] },
    },
    { type: 'assistant', timestamp: at(8), message: { content: [{ type: 'text', text: 'Found **it**.' }] } },
    {
      type: 'assistant',
      timestamp: at(9),
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: '/w/a.ts', old_string: 'a\nb', new_string: 'c' },
          },
        ],
      },
    },
    {
      type: 'assistant',
      isSidechain: true,
      timestamp: at(9),
      message: { content: [{ type: 'text', text: 'a subagent' }] },
    },
    {
      type: 'assistant',
      timestamp: at(10),
      message: {
        content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pnpm test\n--run' } }],
      },
    },
    {
      type: 'user',
      timestamp: at(11),
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'FAIL', is_error: true }] },
    },
    {
      type: 'user',
      timestamp: at(12),
      message: { content: [{ type: 'text', text: '<task-notification>done</task-notification>' }] },
    },
    { type: 'system', subtype: 'turn_duration', durationMs: 11_000 },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: at(20),
      message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    },
    {
      type: 'user',
      uuid: 'u3',
      timestamp: at(30),
      message: { content: '<command-name>/model</command-name>\n<command-args>opus</command-args>' },
    },
  ]
  const [cut, first, second, ...rest] = read('claude', lines)
  expect(rest).toEqual([])
  expect(cut).toMatchObject({ id: 'start', items: [{ kind: 'text', text: 'the end of a turn not read' }] })
  expect(cut?.you).toBeUndefined()
  expect(first).toMatchObject({
    id: 'u1',
    you: { text: 'why does the outline not jump?' },
    model: 'claude-opus-5-5',
    took: 11_000,
  })
  expect(first?.items).toEqual([
    { kind: 'thinking', text: 'slugs differ', ms: 6000 },
    { kind: 'text', text: 'Found **it**.' },
    {
      kind: 'tool',
      id: 't1',
      name: 'Edit',
      target: '/w/a.ts',
      edit: { add: 1, del: 2 },
      error: false,
      done: false,
    },
    { kind: 'tool', id: 't2', name: 'Bash', target: 'pnpm test', output: 'FAIL', error: true, done: true },
    { kind: 'note', note: 'interrupted' },
  ])
  expect(second?.you?.text).toBe('/model opus')
})

test("Codex's completed items, without the instructions it is given, and how its turns ended", () => {
  const item = (item: object, ms: number) => ({
    type: 'event_msg',
    payload: { type: 'item_completed', item, completed_at_ms: ms },
  })
  const lines = [
    { type: 'turn_context', payload: { model: 'gpt-6.1', effort: 'high' } },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions' }],
      },
    },
    item(
      {
        type: 'UserMessage',
        id: 'q1',
        content: [
          { type: 'text', text: 'tidy it\n/tmp/isbell-uploads/0123abcd/b.png' },
          { type: 'local_image', path: '/tmp/a.png' },
        ],
      },
      1,
    ),
    item({ type: 'Reasoning', id: 'r' }, 2),
    item(
      {
        type: 'AgentMessage',
        id: 'm1',
        content: [{ type: 'Text', text: 'Reading it.' }],
        phase: 'commentary',
      },
      3,
    ),
    item(
      {
        type: 'CommandExecution',
        id: 'c1',
        command: ['/bin/zsh', '-lc', 'cat a.md'],
        parsed_cmd: [{ type: 'read', cmd: 'cat a.md', path: 'a.md' }],
        aggregated_output: '# A',
        exit_code: 0,
      },
      4,
    ),
    item(
      {
        type: 'CommandExecution',
        id: 'c2',
        command: ['/bin/zsh', '-lc', 'make'],
        parsed_cmd: [{ type: 'unknown', cmd: 'make' }],
        aggregated_output: 'no rule',
        exit_code: 2,
      },
      5,
    ),
    item(
      {
        type: 'FileChange',
        id: 'f1',
        changes: { '/w/a.md': { type: 'update', unified_diff: '@@ -1 +1,2 @@\n-a\n+b\n+c' } },
      },
      6,
    ),
    { type: 'event_msg', payload: { type: 'task_complete', duration_ms: 9000 } },
    item({ type: 'UserMessage', id: 'q2', content: [{ type: 'text', text: 'stop' }] }, 10),
    {
      type: 'event_msg',
      timestamp: at(11),
      payload: { type: 'turn_aborted', reason: 'interrupted', duration_ms: 1000 },
    },
  ]
  const [first, second] = read('codex', lines)
  expect(first).toMatchObject({
    id: 'q1',
    you: { text: 'tidy it', images: ['/tmp/a.png', '/tmp/isbell-uploads/0123abcd/b.png'] },
    model: 'gpt-6.1 high',
    took: 9000,
  })
  expect(first?.items).toEqual([
    { kind: 'text', text: 'Reading it.' },
    { kind: 'tool', id: 'c1', name: 'Read', target: 'a.md', output: '# A', error: false, done: true },
    { kind: 'tool', id: 'c2', name: 'Bash', target: 'make', output: 'no rule', error: true, done: true },
    {
      kind: 'tool',
      id: 'f1/0',
      name: 'Edit',
      target: '/w/a.md',
      edit: { add: 2, del: 1 },
      error: false,
      done: true,
    },
  ])
  expect(second).toMatchObject({ items: [{ kind: 'note', note: 'interrupted' }], took: 1000 })
})

test("pi's messages: tools by Claude Code's names, their results, and replies that end a turn", () => {
  const msg = (message: object, id = '') => ({ type: 'message', id, message })
  const lines = [
    { type: 'session', id: 's' },
    msg(
      {
        role: 'user',
        content: [{ type: 'text', text: 'list it\n/tmp/isbell-uploads/0123abcd/b.png' }],
        timestamp: 1,
      },
      'p1',
    ),
    msg({
      role: 'assistant',
      model: 'deepseek-v4.1-flash',
      stopReason: 'toolUse',
      timestamp: 2,
      content: [
        { type: 'thinking', thinking: 'ls will do' },
        {
          type: 'toolCall',
          id: 'k1',
          name: 'edit',
          arguments: { path: '/w/b', edits: [{ oldText: 'x', newText: 'y\nz' }] },
        },
      ],
    }),
    msg({
      role: 'toolResult',
      toolCallId: 'k1',
      content: [{ type: 'text', text: 'not found' }],
      isError: true,
      timestamp: 3,
    }),
    msg({ role: 'assistant', stopReason: 'error', errorMessage: '503', timestamp: 4, content: [] }),
  ]
  const [turn] = read('pi', lines)
  expect(turn).toMatchObject({
    id: 'p1',
    you: { text: 'list it', images: ['/tmp/isbell-uploads/0123abcd/b.png'] },
    model: 'deepseek-v4.1-flash',
  })
  expect(turn?.items).toEqual([
    { kind: 'thinking', text: 'ls will do' },
    {
      kind: 'tool',
      id: 'k1',
      name: 'Edit',
      target: '/w/b',
      edit: { add: 2, del: 1 },
      output: 'not found',
      error: true,
      done: true,
    },
    { kind: 'note', note: 'failed', text: '503' },
  ])
})
