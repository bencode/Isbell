// Agent shares: a link that lets someone talk with some of this user's agents, as with their own.
// Each is a space of its own, served by the gateway of every machine that shows agents in it, each
// keeping its own part (`isbell.agentShare.*`); the owner sees them together, by the share's id. The
// link is `/agents#<key>`, the key after the #, so it reaches no server.

import { paneKey } from './projects'
import type { MachineEntry } from './space'

export const PUT = 'isbell.agentShare.put'
export const LIST = 'isbell.agentShare.list'
export const LINK = 'isbell.agentShare.link'
export const STOP = 'isbell.agentShare.stop'
/** Served in a share's space only: the session a pane shared runs. */
export const SESSION = 'isbell.agentShare.session'

export const AGENTS_PATH = '/agents'

/** A share as one machine lists it. */
export type Listed = { id: string; name: string; panes: string[]; expiresAt: number }

/** A share as its owner sees it: the panes it shows, by machine, on every machine holding it. */
export type AgentShare = { id: string; name: string; expiresAt: number; panes: Record<string, string[]> }

/** The shares the machines list, each once, by its note. The note and the end are the latest
 * machine's to have it, as a change reaches one machine after another. */
export function mergeShares(lists: Readonly<Record<string, Listed[]>>): AgentShare[] {
  const byId = new Map<string, AgentShare>()
  for (const [mid, listed] of Object.entries(lists)) {
    for (const { id, name, panes, expiresAt } of listed) {
      const known = byId.get(id)
      const latest = !known || expiresAt > known.expiresAt
      byId.set(id, {
        id,
        name: latest ? name : known.name,
        expiresAt: latest ? expiresAt : known.expiresAt,
        panes: { ...known?.panes, [mid]: panes },
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The machines holding the share. */
export const holders = (share: AgentShare) => Object.keys(share.panes)

/** How many panes it shows, on all its machines. */
export const paneCount = (share: AgentShare) => Object.values(share.panes).flat().length

/** The notes of the shares each pane is in, by pane key. */
export function sharedTo(shares: AgentShare[]): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const share of shares)
    for (const [mid, panes] of Object.entries(share.panes))
      for (const pane of panes) {
        const key = paneKey(mid, pane)
        names.set(key, [...(names.get(key) ?? []), share.name])
      }
  return names
}

export const agentsUrl = (origin: string, key: string) => `${origin}${AGENTS_PATH}#${key}`

/** The key an agents link's fragment holds, if any. */
export function keyOfAgentsHash(hash: string): string | undefined {
  const key = (hash.startsWith('#') ? hash.slice(1) : hash).trim()
  return key || undefined
}

/** A machine of the user's own whose gateway can share its agents. */
export const sharesAgents = (m: MachineEntry | undefined) => !!m?.online && m.state.caps.methods.includes(PUT)

/** A machine seen through a share given to this user: its owner's, showing only what is shared. */
export const sharedWithMe = (m: MachineEntry | undefined) => !!m?.state.caps.methods.includes(SESSION)
