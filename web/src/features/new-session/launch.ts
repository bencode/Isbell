// Starting something in a directory: an agent, given a task or not, or a plain shell. Shared by the
// New panel and the task box on the board.

import { updateLocal } from '../../core/prefs'
import { openShell, type Started, startAgent } from '../../model/herdr'
import { projectKey } from '../../model/projects'
import type { Space } from '../../model/space'
import { sessionHref, terminalHref } from '../../utils/hrefs'

export type Mode = 'chat' | 'terminal'
/** The agent choice that starts no agent: a plain shell. Agent kinds never contain ':'. */
export const SHELL = ':shell'

/** Where to start: a directory on a machine, and how to show it. */
export type Target = { mid: string; path: string; machine: string; display: string }

/** Starts what was asked for and says where to go next. */
export async function launch(
  space: Space,
  { mid, path }: Target,
  mode: Mode,
  kind: string,
  prompt: string,
): Promise<{ href: string; state?: { promptError?: Started['promptError'] } }> {
  if (kind === SHELL) {
    const paneId = await openShell(space.openThenEnd, mid, path)
    await space.refreshShells(mid)
    return { href: terminalHref(mid, paneId) }
  }
  const started = await startAgent(space.call, mid, {
    cwd: path,
    kind,
    ...(mode === 'chat' && prompt ? { prompt } : {}),
  })
  return mode === 'chat'
    ? { href: sessionHref(mid, started.paneId), state: { promptError: started.promptError } }
    : { href: terminalHref(mid, started.paneId) }
}

/** The agents a machine has, the ones used most recently first. */
export function agentsFor(kinds: string[], recent: string[]) {
  const rank = (k: string) => (recent.includes(k) ? recent.indexOf(k) : recent.length)
  return [...kinds].sort((a, b) => rank(a) - rank(b))
}

/** Remembers the agent started at `target`, for the next start there and anywhere. */
export const rememberAgent = (target: Target, kind: string) =>
  updateLocal(l => ({
    lastAgent: { ...l.lastAgent, [projectKey(target.mid, target.path)]: kind },
    recentAgents: [kind, ...l.recentAgents.filter(k => k !== kind)],
  }))
