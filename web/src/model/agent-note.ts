// What herdr knows of an agent besides its screen: the title it gives its terminal, and what
// Isbell's hook in it (integrations/agent-hook.sh) reports as it works.

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
}

/** The part of herdr's agent info read. */
export type AgentInfo = {
  agent?: string | null
  cwd?: string | null
  terminal_title_stripped?: string | null
  tokens?: Record<string, string | null> | null
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? ''

/** A title naming no task: the agent's own name before it has one, or the directory it is in. */
const says = (title: string, info: AgentInfo) =>
  ![info.agent ?? '', 'Claude Code', baseName(info.cwd ?? '')].some(
    plain => plain.toLowerCase() === title.toLowerCase(),
  )

function titleOf(info: AgentInfo): string | undefined {
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
  return {
    ...(title ? { title } : {}),
    ...(asked ? { asked } : {}),
    ...(doing ? { doing } : {}),
    ...(asking ? { asking } : {}),
    ...(mode && mode !== 'default' ? { mode } : {}),
  }
}
