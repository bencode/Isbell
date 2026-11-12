// What a machine starts an agent with, in a file of its own: each template a name, the agent herdr is
// to recognize, and the command that starts it, after which Isbell puts its own arguments, to start a
// session or resume one. Without the file, a machine starts each agent by its own name.

import { CHAT_AGENTS } from './agents'
import { read, writeText } from './files/remote'
import type { Space } from './space'
import type { Caps } from './state'
import { CallError } from './streams'

export type StartTemplate = { name: string; agent: string; command: string }

/** A file that cannot be read is never written over, as with the projects. */
export type Templates = { state: 'listed' | 'missing'; templates: StartTemplate[] } | { state: 'broken' }

export const templatesPath = '~/.isbell/templates.json'
/** What a gateway serves to start an agent by a command of the user's own. */
export const LAUNCH_METHOD = 'isbell.agent.launch'
const START_METHOD = 'isbell.agent.start'

const VERSION = 1
const FILE_MAX = 1 << 20
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const CONTROL = /[\u0000-\u001f\u007f]/

export const DEFAULT_TEMPLATES: StartTemplate[] = CHAT_AGENTS.map(agent => ({
  name: agent,
  agent,
  command: agent,
}))

/** Started as herdr starts the agent, by its own name. */
export const plain = (t: StartTemplate) => t.command.trim() === t.agent

/** Why `t` cannot be among `others`, if it cannot. */
export function problem(
  t: StartTemplate,
  others: StartTemplate[],
): 'name' | 'command' | 'duplicate' | undefined {
  if (!t.name.trim()) return 'name'
  if (!t.command.trim() || CONTROL.test(t.command)) return 'command'
  if (others.some(o => o.name.trim() === t.name.trim())) return 'duplicate'
  return undefined
}

const isTemplate = (v: unknown): v is StartTemplate => {
  const t = v as Partial<StartTemplate> | null
  return (
    typeof t?.name === 'string' &&
    typeof t.agent === 'string' &&
    CHAT_AGENTS.includes(t.agent) &&
    typeof t.command === 'string'
  )
}

/** The templates `text` lists; undefined when it is no such file, or any of them could not be used. */
export function parseTemplates(text: string): StartTemplate[] | undefined {
  try {
    const file = JSON.parse(text) as { version?: unknown; templates?: unknown } | null
    if (file?.version !== VERSION || !Array.isArray(file.templates) || !file.templates.every(isTemplate))
      return undefined
    const templates = file.templates.map(({ name, agent, command }) => ({ name, agent, command }))
    return templates.every((t, i) => !problem(t, templates.slice(0, i))) ? templates : undefined
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

export const serializeTemplates = (templates: StartTemplate[]) =>
  `${JSON.stringify({ version: VERSION, templates }, null, 2)}\n`

/** What machine `mid` starts agents with, read from its file now. */
export async function readTemplates(open: Space['openStream'], mid: string): Promise<Templates> {
  try {
    const found = await read(open, mid, templatesPath, FILE_MAX)
    const templates = found.bytes && parseTemplates(new TextDecoder().decode(found.bytes))
    if (templates) return { state: 'listed', templates }
    console.warn('the start templates cannot be read', mid)
    return { state: 'broken' }
  } catch (err) {
    if (!(err instanceof CallError)) throw err
    if (err.code === 'not_found' || err.code === 'bad_request')
      return { state: 'missing', templates: DEFAULT_TEMPLATES }
    if (err.code !== 'not_a_file' && err.code !== 'permission_denied') throw err
    console.warn('the start templates cannot be read', mid, err)
    return { state: 'broken' }
  }
}

export const writeTemplates = (open: Space['openStream'], mid: string, templates: StartTemplate[]) =>
  writeText(open, mid, templatesPath, serializeTemplates(templates))

export type StartCall =
  | { method: typeof START_METHOD; p: { cwd: string; kind: string; args: string[] } }
  | { method: typeof LAUNCH_METHOD; p: { cwd: string; kind: string; command: string; args: string[] } }

/** Starting `t` in `cwd` with `args` after its command: by herdr where it is the agent's own name,
 * else by the gateway typing it into a shell. */
export function startCall(t: StartTemplate, cwd: string, args: string[]): StartCall {
  const kind = t.agent
  return plain(t)
    ? { method: START_METHOD, p: { cwd, kind, args } }
    : { method: LAUNCH_METHOD, p: { cwd, kind, command: t.command.trim(), args } }
}

/** What a new session of `agent` starts with. In its regular mode pi leaves the conversation in the
 * terminal's history, where the chat reads it. */
export const newArgs = (agent: string): string[] => (agent === 'pi' ? ['--tui-mode', 'regular'] : [])

/** Whether the machine can start `t`: herdr has its agent, and a command of its own needs a gateway
 * that types it. */
export const usable = (t: StartTemplate, caps: Caps): boolean =>
  caps.agentKinds.includes(t.agent) && (plain(t) || caps.methods.includes(LAUNCH_METHOD))
