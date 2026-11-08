// The gateway calls the web client makes: herdr's whitelisted methods, passed through, and
// Isbell's own `isbell.agent.start`, `isbell.pane.processes` and `isbell.terminal`.

import { type AgentInfo, type AgentNote, noteOf } from './agent-note'

export type Caller = (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>

/** A pane without an agent: a plain shell. `ran`: the session an agent last reported running in it,
 * which outlives the agent there. */
export type Shell = {
  mid: string
  paneId: string
  cwd: string
  title?: string
  ran?: { agent: string; id: string }
}

const HERDR_TIMEOUT_MS = 35_000
/** Starting an agent waits for it to come up and take the prompt. */
const START_TIMEOUT_MS = 150_000
const OPEN_TIMEOUT_MS = 50_000

const herdr = (call: Caller, mid: string, method: string, params: unknown) =>
  call(mid, 'herdr', { method, params }, HERDR_TIMEOUT_MS)

type PaneInfo = {
  pane_id: string
  agent?: string | null
  cwd?: string | null
  foreground_cwd?: string | null
  terminal_title_stripped?: string | null
  tokens?: Record<string, string | null> | null
}

export async function shells(call: Caller, mid: string): Promise<Shell[]> {
  const r = (await herdr(call, mid, 'session.snapshot', {})) as { snapshot?: { panes?: PaneInfo[] } }
  return (r.snapshot?.panes ?? []).flatMap(p => {
    const cwd = p.foreground_cwd ?? p.cwd
    if (p.agent || !cwd) return []
    const title = p.terminal_title_stripped
    const agent = p.tokens?.isbell_agent
    const id = p.tokens?.isbell_session
    return [
      {
        mid,
        paneId: p.pane_id,
        cwd,
        ...(title ? { title } : {}),
        ...(agent && id ? { ran: { agent, id } } : {}),
      },
    ]
  })
}

/** What herdr knows of the agent besides its screen. */
export const agentNote = async (call: Caller, mid: string, paneId: string): Promise<AgentNote> =>
  noteOf(((await herdr(call, mid, 'agent.get', { target: paneId })) as { agent?: AgentInfo }).agent ?? {})

/** A process in a pane's foreground; `started` in Unix milliseconds. */
type PaneProcess = { pid: number; name: string; argv: string[] | null; started: number | null }

export const paneProcesses = async (call: Caller, mid: string, paneId: string): Promise<PaneProcess[]> =>
  (
    (await call(mid, 'isbell.pane.processes', { pane_id: paneId }, HERDR_TIMEOUT_MS)) as {
      processes: PaneProcess[]
    }
  ).processes

const CODEX = /(^|\/)codex(\.js)?$/

/** When the pane's codex started: the native binary, or the script node runs. */
export const codexStarted = (processes: PaneProcess[]): number | undefined =>
  processes.find(p => p.name === 'codex' || [p.argv?.[0], p.argv?.[1]].some(arg => arg && CODEX.test(arg)))
    ?.started ?? undefined

export const prompt = (call: Caller, mid: string, paneId: string, text: string) =>
  herdr(call, mid, 'agent.prompt', { target: paneId, text })

export const sendKeys = (call: Caller, mid: string, paneId: string, keys: string[]) =>
  herdr(call, mid, 'agent.send_keys', { target: paneId, keys })

/** Gives the agent `name` in herdr, or takes its name away for null. */
export const renameAgent = (call: Caller, mid: string, paneId: string, name: string | null) =>
  herdr(call, mid, 'agent.rename', { target: paneId, name })

export const closePane = (call: Caller, mid: string, paneId: string) =>
  herdr(call, mid, 'pane.close', { pane_id: paneId })

export type Started = { name: string; paneId: string; promptError?: { code: string; msg: string } }

export const startAgent = async (
  call: Caller,
  mid: string,
  p: { cwd: string; kind: string; args?: string[]; prompt?: string },
): Promise<Started> => (await call(mid, 'isbell.agent.start', p, START_TIMEOUT_MS)) as Started

/** Opens a shell in `cwd` and lets go of it at once: the shell stays in herdr. */
export async function openShell(openThenEnd: Caller, mid: string, cwd: string): Promise<string> {
  const r = (await openThenEnd(
    mid,
    'isbell.terminal',
    { new: { cwd }, mode: 'control', cols: 80, rows: 24 },
    OPEN_TIMEOUT_MS,
  )) as { paneId: string }
  return r.paneId
}
