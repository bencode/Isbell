// What herdr knows of an agent besides its screen: the title it gives its terminal, the session it
// made out, and what Isbell's hook in it (integrations/agent-hook.sh) reports as it works.

export type ToolUse = { tool: string; target?: string }

export type AgentNote = {
  /** The task, as the agent titles its terminal; none while the title says nothing of it. */
  title?: string
  /** What the turn going on was asked. */
  asked?: string
  /** The tool it runs now. */
  doing?: ToolUse
  /** The tool it asks leave to run. */
  asking?: ToolUse
  /** Its permission mode, when not the default. */
  mode?: string
  /** The agent's own id for the session running in the pane: as its hook reported it, else as herdr
   * made it out. */
  session?: string
  /** The file herdr found that session kept in (pi's), for a record that does not say. */
  file?: string
}

/** The part of herdr's agent info read. */
export type AgentInfo = {
  agent?: string | null
  cwd?: string | null
  terminal_title_stripped?: string | null
  tokens?: Record<string, string | null> | null
  /** The session herdr found the agent in: its id, or the file it is kept in. */
  agent_session?: { agent?: string | null; kind?: string | null; value?: string | null } | null
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? ''

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** The session's id from herdr: given as is, or the last id in the name of the file it is kept in
 * (pi's `<time>_<id>.jsonl`). Only for the agent in the pane now. */
function herdrSession(info: AgentInfo): string | undefined {
  const s = info.agent_session
  if (!s?.value || s.agent !== info.agent) return undefined
  if (s.kind === 'id') return s.value
  return s.kind === 'path' ? baseName(s.value).match(UUID)?.at(-1) : undefined
}

/** The file herdr found the session of the agent in the pane now kept in. */
const herdrFile = (info: AgentInfo) => {
  const s = info.agent_session
  return s?.kind === 'path' && s.value && s.agent === info.agent ? s.value : undefined
}

/** The command that started the agent, as its terminal is titled until the agent titles it. */
const command = (title: string, agent: string) => {
  const [first, ...rest] = title.split(/\s+/)
  return first === agent && rest.every(word => word.startsWith('-'))
}

/** A title naming no task: the agent's own name before it has one, the command that started it, or
 * the directory it is in, alone or after pi's mark. */
const says = (title: string, info: AgentInfo) => {
  const dir = baseName(info.cwd ?? '')
  return (
    !command(title, info.agent ?? '') &&
    ![info.agent ?? '', 'Claude Code', dir, `π - ${dir}`].some(
      plain => plain.toLowerCase() === title.toLowerCase(),
    )
  )
}

/** The task the agent's terminal is titled with, if it names one. */
export function titleOf(info: AgentInfo): string | undefined {
  const raw = info.terminal_title_stripped?.trim() ?? ''
  // Codex titles its terminal "task | directory".
  const title = info.agent === 'codex' ? raw.replace(/ \| [^|]*$/, '') : raw
  return title && says(title, info) ? title : undefined
}

const toolUse = (tool: string | undefined, target: string | undefined): ToolUse | undefined =>
  tool ? (target ? { tool, target } : { tool }) : undefined

export function noteOf(info: AgentInfo): AgentNote {
  // What an agent's hook left in a pane outlives it there, so it is read only for the agent that
  // reported it; the hook's first version, for Claude Code alone, did not say which.
  const ours = (info.tokens?.isbell_agent ?? 'claude') === info.agent
  const token = (name: string) => (ours ? info.tokens?.[name] || undefined : undefined)
  const title = titleOf(info)
  const asked = token('isbell_ask')
  const doing = toolUse(token('isbell_tool'), token('isbell_target'))
  const asking = toolUse(token('isbell_wait_tool'), token('isbell_wait_target'))
  const mode = token('isbell_mode')
  const session = token('isbell_session') ?? herdrSession(info)
  const file = session ? herdrFile(info) : undefined
  return {
    ...(title ? { title } : {}),
    ...(asked ? { asked } : {}),
    ...(doing ? { doing } : {}),
    ...(asking ? { asking } : {}),
    ...(mode && mode !== 'default' ? { mode } : {}),
    ...(session ? { session } : {}),
    ...(file ? { file } : {}),
  }
}
