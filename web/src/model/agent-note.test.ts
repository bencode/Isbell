import { expect, test } from 'vitest'
import { noteOf } from './agent-note'

test("what the hook reports is the turn's question, the tool it runs and the one it asks to run", () => {
  expect(
    noteOf({
      agent: 'claude',
      tokens: {
        isbell_ask: 'review PR #90',
        isbell_tool: 'Bash',
        isbell_target: 'Run web unit tests',
        isbell_wait_tool: 'Write',
        isbell_wait_target: 'notes.txt',
        isbell_mode: 'plan',
      },
    }),
  ).toEqual({
    asked: 'review PR #90',
    doing: { tool: 'Bash', target: 'Run web unit tests' },
    asking: { tool: 'Write', target: 'notes.txt' },
    mode: 'plan',
  })
})

test('cleared or empty reports, and the default mode, say nothing', () => {
  expect(
    noteOf({
      agent: 'claude',
      tokens: { isbell_ask: '', isbell_tool: null, isbell_target: 'x', isbell_mode: 'default' },
    }),
  ).toEqual({})
  expect(noteOf({ agent: 'claude', tokens: { isbell_tool: 'ToolSearch' } })).toEqual({
    doing: { tool: 'ToolSearch' },
  })
  expect(noteOf({ agent: 'claude', tokens: null })).toEqual({})
})

test("what Claude's hook left in a pane says nothing of another agent started there", () => {
  expect(noteOf({ agent: 'codex', tokens: { isbell_ask: 'old question', isbell_tool: 'Bash' } })).toEqual({})
})

test("Codex's reports, its session among them, are read for Codex, and not for Claude Code started in its pane after it", () => {
  const tokens = {
    isbell_agent: 'codex',
    isbell_ask: 'fix the build',
    isbell_tool: 'Edit',
    isbell_target: 'main.rs',
    isbell_session: 'thread-1',
  }
  expect(noteOf({ agent: 'codex', tokens })).toEqual({
    asked: 'fix the build',
    doing: { tool: 'Edit', target: 'main.rs' },
    session: 'thread-1',
  })
  expect(noteOf({ agent: 'claude', tokens })).toEqual({})
})

test('the terminal title is the task, unless it only names the agent, the command that started it, or its directory', () => {
  const title = (agent: string, title: string) =>
    noteOf({ agent, cwd: '/Users/me/work/Isbell', terminal_title_stripped: title }).title
  expect(title('claude', 'Baton PR #90')).toBe('Baton PR #90')
  expect(title('codex', '切换到新方案 | Isbell')).toBe('切换到新方案')
  expect(title('claude', 'Claude Code')).toBeUndefined()
  expect(title('codex', 'codex')).toBeUndefined()
  expect(title('codex', 'codex --no-daemon | Isbell')).toBeUndefined()
  expect(title('codex', 'codex fixes the build | Isbell')).toBe('codex fixes the build')
  expect(title('codex', 'Isbell')).toBeUndefined()
  expect(title('pi', 'π - Isbell')).toBeUndefined()
  expect(title('claude', ' ')).toBeUndefined()
})

test("herdr's session stands in for one the hook has not reported, for the agent in the pane alone", () => {
  const id = '66a3ee45-fe22-43be-874b-0bc10ff867e2'
  expect(noteOf({ agent: 'claude', agent_session: { agent: 'claude', kind: 'id', value: id } })).toEqual({
    session: id,
  })
  const file = `/h/.pi/agent/sessions/--w--/2026-11-01T03-29-35-314Z_${id}.jsonl`
  expect(noteOf({ agent: 'pi', agent_session: { agent: 'pi', kind: 'path', value: file } })).toEqual({
    session: id,
    file,
  })
  expect(noteOf({ agent: 'codex', agent_session: { agent: 'pi', kind: 'path', value: file } })).toEqual({})
  const tokens = { isbell_agent: 'claude', isbell_session: 'reported' }
  expect(
    noteOf({ agent: 'claude', tokens, agent_session: { agent: 'claude', kind: 'id', value: id } }),
  ).toEqual({
    session: 'reported',
  })
})
