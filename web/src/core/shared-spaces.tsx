// The agent shares given to this user and joined here: a space each, open while the workbench is,
// beside the user's own. Their agents show in the right column's Agents and open in the peek.

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { parseKey } from '../model/identity'
import { createSpace, type Space } from '../model/space'
import { useLocal } from './prefs'
import { RELAY_URL } from './space'

export type SharedSpace = { key: string; sid: string; space: Space }

/** Undefined until the shares joined are first connected. */
const SharedContext = createContext<SharedSpace[] | undefined>(undefined)

export function SharedSpacesProvider({ children }: { children: ReactNode }) {
  const keys = useLocal().sharesJoined
  const [shared, setShared] = useState<SharedSpace[]>()
  const open = useRef(new Map<string, SharedSpace>())

  // A share joined is connected once, and closed once left.
  useEffect(() => {
    const spaces = open.current
    for (const [key, s] of spaces) {
      if (keys.includes(key)) continue
      s.space.close()
      spaces.delete(key)
    }
    for (const key of keys) {
      if (spaces.has(key)) continue
      try {
        const id = parseKey(key)
        spaces.set(key, { key, sid: id.sid, space: createSpace(RELAY_URL, id) })
      } catch (err) {
        console.warn('a share joined has a key that is not one', err)
      }
    }
    setShared(keys.flatMap(key => spaces.get(key) ?? []))
  }, [keys])

  useEffect(() => {
    const spaces = open.current
    // Back on the page, or online again, each reconnects at once rather than at its next try.
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      for (const s of spaces.values()) s.space.reconnectNow()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      for (const s of spaces.values()) s.space.close()
      spaces.clear()
    }
  }, [])

  return <SharedContext.Provider value={shared}>{children}</SharedContext.Provider>
}

export const useSharedSpaces = () => useContext(SharedContext) ?? []

/** Whether the shares joined are connected yet, so that one not among them is one left. */
export const useSharedSpacesReady = () => useContext(SharedContext) !== undefined
