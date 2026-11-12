import { expect, test } from 'vitest'
import {
  DEFAULT_TEMPLATES,
  LAUNCH_METHOD,
  newArgs,
  parseTemplates,
  problem,
  type StartTemplate,
  startCall,
  usable,
} from './start-templates'

const [claude] = DEFAULT_TEMPLATES as [StartTemplate]
const rec = { name: 'Claude · rec', agent: 'claude', command: 'reclaude' }
const file = (templates: unknown, version = 1) => JSON.stringify({ version, templates })

test('a file is read whole, or not at all where any template in it could not be used', () => {
  const templates = [...DEFAULT_TEMPLATES, rec]
  expect(parseTemplates(file(templates))).toEqual(templates)
  expect(parseTemplates(file([rec], 2))).toBeUndefined()
  expect(parseTemplates(file([{ name: 'x', agent: 'gemini', command: 'gemini' }]))).toBeUndefined()
  expect(parseTemplates(file([{ name: 'x', agent: 'claude' }]))).toBeUndefined()
  expect(parseTemplates(file([rec, { ...rec, command: 'claude' }]))).toBeUndefined()
  expect(parseTemplates(file([{ ...rec, command: 'reclaude\nrm -rf ~' }]))).toBeUndefined()
  expect(parseTemplates('{"version": 1, "templates": [')).toBeUndefined()
})

test('a template needs a name of its own and a one-line command', () => {
  expect(problem(rec, DEFAULT_TEMPLATES)).toBeUndefined()
  expect(problem({ ...rec, name: ' ' }, [])).toBe('name')
  expect(problem({ ...rec, command: '' }, [])).toBe('command')
  expect(problem({ ...rec, command: 'a\tb' }, [])).toBe('command')
  expect(problem({ ...rec, name: 'claude ' }, DEFAULT_TEMPLATES)).toBe('duplicate')
})

test("an agent's own name starts it by herdr; any other command, by the gateway typing it", () => {
  expect(startCall(claude, '/srv/a', ['--resume', 's1'])).toEqual({
    method: 'isbell.agent.start',
    p: { cwd: '/srv/a', kind: 'claude', args: ['--resume', 's1'] },
  })
  expect(startCall({ ...rec, command: ' cc_glm && claude ' }, '/srv/a', [])).toEqual({
    method: LAUNCH_METHOD,
    p: { cwd: '/srv/a', kind: 'claude', command: 'cc_glm && claude', args: [] },
  })
  expect(newArgs('pi')).toEqual(['--tui-mode', 'regular'])
  expect(newArgs('claude')).toEqual([])
})

test('a machine starts what herdr knows, and a command of its own only on a gateway that types it', () => {
  const old = { methods: ['isbell.agent.start'], agentKinds: ['claude', 'codex'] }
  const now = { ...old, methods: [...old.methods, LAUNCH_METHOD] }
  expect(usable(claude, old)).toBe(true)
  expect(usable(rec, old)).toBe(false)
  expect(usable(rec, now)).toBe(true)
  expect(usable({ name: 'pi', agent: 'pi', command: 'pi' }, now)).toBe(false)
})
