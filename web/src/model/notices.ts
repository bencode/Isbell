// Which changes of a session are worth telling the user of. Agents often run for minutes, and being
// told of every finish is noise. A phone's pushes follow the same rule in the gateway's `push`.

import type { AgentStatus } from './state'
import { peekOf, sessionTabId, tabOf } from './tabs'

const LONG_RUN_MS = 10 * 60_000

export type Seen = { status: AgentStatus; statusSince: number }

/** `was`: how the session stood before, if it was seen. Asking is always told of; finishing only
 * after a long run. */
export function worthTelling(was: Seen | undefined, now: Seen): boolean {
  if (was?.status === now.status) return false
  if (now.status === 'blocked') return true
  return (
    now.status === 'done' && was?.status === 'working' && now.statusSince - was.statusSince >= LONG_RUN_MS
  )
}

/** Whether the address `search` has this session in front of the user. */
export function showsSession(search: string, mid: string, paneId: string): boolean {
  const peek = peekOf(search)
  if (peek) return peek.mid === mid && peek.paneId === paneId
  return tabOf(search, () => true) === sessionTabId(mid, paneId)
}
