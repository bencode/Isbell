// Agents ended from the board: each pane closes a moment after, unless undone meanwhile, so ending
// one asks nothing; ending several at once is asked first and closes them at once. Kept for this
// page's life only: an ending not yet due when the page reloads is dropped, and the pane stays.

import { useSyncExternalStore } from 'react'
import { type Caller, closePane } from '../model/herdr'
import { paneKey } from '../model/projects'

/** How long an ending can still be undone before the pane closes. */
export const UNDO_MS = 5000

/** 'soon' until it closes (undoable), 'closing' once asked (until the machine reports the pane gone
 * and its card leaves), or why it failed. */
export type Ending = 'soon' | 'closing' | { failed: unknown }

/** By paneKey. */
const endings = new Map<string, Ending>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function settle(key: string, ending: Ending | undefined) {
  clearTimeout(timers.get(key))
  timers.delete(key)
  if (ending === undefined) endings.delete(key)
  else endings.set(key, ending)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Closes the agent's pane after UNDO_MS; asked again, it waits that long afresh. */
export function endSoon(call: Caller, mid: string, paneId: string) {
  const key = paneKey(mid, paneId)
  settle(key, 'soon')
  timers.set(
    key,
    setTimeout(() => void endNow(call, mid, paneId), UNDO_MS),
  )
}

/** Leaves the agent running: its ending is forgotten, whether due or failed. */
export const undoEnd = (mid: string, paneId: string) => settle(paneKey(mid, paneId), undefined)

/** Closes the agent's pane now; false, with why kept as its ending, when it could not. */
export async function endNow(call: Caller, mid: string, paneId: string): Promise<boolean> {
  const key = paneKey(mid, paneId)
  settle(key, 'closing')
  try {
    await closePane(call, mid, paneId)
    return true
  } catch (err) {
    console.error(`could not end ${paneId} on ${mid}`, err)
    settle(key, { failed: err })
    return false
  }
}

export const useEnding = (mid: string, paneId: string): Ending | undefined =>
  useSyncExternalStore(subscribe, () => endings.get(paneKey(mid, paneId)))
