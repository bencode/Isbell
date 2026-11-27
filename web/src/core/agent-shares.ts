// The user's agent shares, as their machines list them: pulled once for every view, every 30 seconds
// while the page shows, at once when a machine that can share comes online, and after each change
// made here. A change goes to every machine holding the share, with its key, which only they keep.

import { useEffect, useSyncExternalStore } from 'react'
import {
  type AgentShare,
  agentsUrl,
  holders,
  LINK,
  LIST,
  type Listed,
  mergeShares,
  PUT,
  STOP,
  sharesAgents,
} from '../model/agent-share'
import { LASTS, type Lasts } from '../model/share'
import type { Space } from '../model/space'
import { useSpace } from './space'

const EVERY_MS = 30_000
const CALL_MS = 15_000
/** Taken off an end asked for: the machine checks it against its own clock, which the browser's may
 * be ahead of, and refuses one past seven days from its now. */
const CLOCK_MARGIN_MS = 60_000

const endIn = (lasts: Lasts) => Date.now() + LASTS[lasts] - CLOCK_MARGIN_MS

let lists: Readonly<Record<string, Listed[]>> = {}
let shares: AgentShare[] = []
/** Counts the refreshes started: only the latest settles, so a pull begun before a change made
 * here cannot bring back what was listed before it. */
let started = 0
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function settle(next: Readonly<Record<string, Listed[]>>) {
  lists = next
  shares = mergeShares(lists)
  for (const listener of listeners) listener()
}

/** The machines that can share their agents now. */
const able = (space: Space) =>
  space
    .getSnapshot()
    .machines.filter(sharesAgents)
    .map(m => m.state.machine.id)

/** Lists every machine's shares again; one that cannot be asked keeps what it last listed, and one
 * gone from those that can is dropped. */
export async function refreshShares(space: Space) {
  const seq = ++started
  const mids = able(space)
  const listed = await Promise.all(
    mids.map(async mid => {
      try {
        return [mid, (await space.call(mid, LIST, {}, CALL_MS)) as Listed[]] as const
      } catch (err) {
        console.warn('could not list the agent shares of', mid, err)
        return lists[mid] ? ([mid, lists[mid]] as const) : undefined
      }
    }),
  )
  if (seq === started) settle(Object.fromEntries(listed.filter(entry => entry !== undefined)))
}

/** Keeps the shares listed while the page shows; mounted once. */
export function useAgentSharesPull() {
  const space = useSpace()
  useEffect(() => {
    let live = true
    let pulling = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let known = new Set<string>()
    const tick = async () => {
      pulling = true
      known = new Set(able(space))
      await refreshShares(space)
      pulling = false
      if (live) timer = setTimeout(next, EVERY_MS)
    }
    const next = () => {
      if (document.visibilityState === 'visible') void tick()
      else timer = setTimeout(next, EVERY_MS)
    }
    const wake = () => {
      if (pulling || document.visibilityState !== 'visible') return
      clearTimeout(timer)
      void tick()
    }
    const unsubscribe = space.subscribe(() => {
      const mids = able(space)
      known = new Set(mids.filter(mid => known.has(mid)))
      if (mids.some(mid => !known.has(mid))) wake()
    })
    document.addEventListener('visibilitychange', wake)
    next()
    return () => {
      live = false
      clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [space])
}

export const useAgentShares = (): AgentShare[] => useSyncExternalStore(subscribe, () => shares)

/** Starts a share on machine `mid`, showing nothing yet; answers its id. */
export async function startShare(space: Space, mid: string, name: string, lasts: Lasts) {
  const { id } = (await space.call(mid, PUT, { name, expiresAt: endIn(lasts), panes: [] }, CALL_MS)) as {
    id: string
  }
  await refreshShares(space)
  return id
}

/** The key of share `id`, from machine `mid`, which holds it. */
const keyFrom = async (space: Space, mid: string, id: string) =>
  ((await space.call(mid, LINK, { id }, CALL_MS)) as { key: string }).key

/** The share's key, from a machine holding it. */
async function keyOf(space: Space, share: AgentShare) {
  const [mid] = holders(share)
  if (!mid) throw new Error('no machine holds this share')
  return keyFrom(space, mid, share.id)
}

/** The link to share `id`, from machine `mid`, which holds it. */
export const shareLink = async (space: Space, mid: string, id: string) =>
  agentsUrl(window.location.origin, await keyFrom(space, mid, id))

/** Shows `panes` of machine `mid` in the share, on that machine too if it held none of it yet. */
export async function setPanes(space: Space, share: AgentShare, mid: string, panes: string[]) {
  const key = await keyOf(space, share)
  await space.call(mid, PUT, { key, name: share.name, expiresAt: share.expiresAt, panes }, CALL_MS)
  await refreshShares(space)
}

/** Gives the share a new note, or a new end `lasts` from now, on every machine holding it. */
export async function changeShare(space: Space, share: AgentShare, change: { name?: string; lasts?: Lasts }) {
  const key = await keyOf(space, share)
  const name = change.name ?? share.name
  const expiresAt = change.lasts ? endIn(change.lasts) : share.expiresAt
  try {
    await Promise.all(
      holders(share).map(mid =>
        space.call(mid, PUT, { key, name, expiresAt, panes: share.panes[mid] ?? [] }, CALL_MS),
      ),
    )
  } finally {
    await refreshShares(space)
  }
}

/** Ends the share on every machine holding it: its link stops at once. */
export async function stopShare(space: Space, share: AgentShare) {
  try {
    await Promise.all(holders(share).map(mid => space.call(mid, STOP, { id: share.id }, CALL_MS)))
  } finally {
    await refreshShares(space)
  }
}
