// The gateway calls the web client makes: herdr's whitelisted methods, passed through, and
// Isbell's own `isbell.agent.start` and `isbell.terminal`.

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

/**
 * The pane's output as plain text: `recent` includes scrollback, `visible` is the screen alone.
 * herdr cannot capture a full-screen agent's scrollback while it is working; read `visible` then.
 */
export async function readScreen(
  call: Caller,
  mid: string,
  paneId: string,
  source: 'recent' | 'visible',
): Promise<string> {
  const params = source === 'recent' ? { target: paneId, source, lines: 200 } : { target: paneId, source }
  const r = (await herdr(call, mid, 'agent.read', params)) as { read?: { text?: string } }
  return r.read?.text ?? ''
}

export const prompt = (call: Caller, mid: string, paneId: string, text: string) =>
  herdr(call, mid, 'agent.prompt', { target: paneId, text })

export const sendKeys = (call: Caller, mid: string, paneId: string, keys: string[]) =>
  herdr(call, mid, 'agent.send_keys', { target: paneId, keys })

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
