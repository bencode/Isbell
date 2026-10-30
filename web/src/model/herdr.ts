// The gateway calls the web client makes: herdr's whitelisted methods, passed through, and
// Isbell's own `isbell.agent.start` and `isbell.terminal`.

import { type AgentInfo, type AgentNote, noteOf } from './agent-note'

export type Caller = (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>

/** A pane without an agent: a plain shell. */
export type Shell = { mid: string; paneId: string; cwd: string; title?: string }

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
}

export async function shells(call: Caller, mid: string): Promise<Shell[]> {
  const r = (await herdr(call, mid, 'session.snapshot', {})) as { snapshot?: { panes?: PaneInfo[] } }
  return (r.snapshot?.panes ?? []).flatMap(p => {
    const cwd = p.foreground_cwd ?? p.cwd
    if (p.agent || !cwd) return []
    const title = p.terminal_title_stripped
    return [title ? { mid, paneId: p.pane_id, cwd, title } : { mid, paneId: p.pane_id, cwd }]
  })
}

const RECENT_LINES = 200

/**
 * The pane's output as plain text: `recent` is its last lines with scrollback, each as the program
 * wrote it rather than wrapped to the pane; `visible` is the screen alone. herdr captures a
 * full-screen agent's scrollback only while the agent is idle or done; read `visible` otherwise.
 */
export async function readScreen(
  call: Caller,
  mid: string,
  paneId: string,
  source: 'recent' | 'visible',
): Promise<string> {
  const params =
    source === 'recent'
      ? { target: paneId, source: 'recent_unwrapped', lines: RECENT_LINES }
      : { target: paneId, source }
  const r = (await herdr(call, mid, 'agent.read', params)) as { read?: { text?: string } }
  const text = r.read?.text ?? ''
  if (source === 'visible') return text
  // A read that stops inside the history can have the header an agent pins over its top line
  // (Codex shows the prompt of the turn in view); a full read leaves that line out.
  const lines = text.replace(/\n$/, '').split('\n')
  return lines.length < RECENT_LINES ? text : lines.slice(1).join('\n')
}

/** What herdr knows of the agent besides its screen. */
export const agentNote = async (call: Caller, mid: string, paneId: string): Promise<AgentNote> =>
  noteOf(((await herdr(call, mid, 'agent.get', { target: paneId })) as { agent?: AgentInfo }).agent ?? {})

export type History = { text: string; more: boolean }

/**
 * Up to `count` lines of the pane's history ending `skip` lines above its last, each as the agent
 * wrote it, and whether earlier lines may remain. Only while the agent is idle or done.
 */
export const readHistory = async (
  call: Caller,
  mid: string,
  paneId: string,
  skip: number,
  count: number,
): Promise<History> =>
  (await call(mid, 'isbell.agent.history', { target: paneId, skip, count }, HERDR_TIMEOUT_MS)) as History

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
  p: { cwd: string; kind: string; prompt?: string },
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
