// The space connection for the whole app, and the projects derived from it.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { parseKey } from '../model/identity'
import { deriveProjects, type Project } from '../model/projects'
import { createSpace, type Space, type SpaceView } from '../model/space'
import { useLocal } from './prefs'

export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? 'wss://isbell.fmap.dev/v1/ws'
/** State lists agents only; shells are pulled this often while the page is visible. */
const SHELLS_EVERY_MS = 15_000

const SpaceContext = createContext<Space | null>(null)

export function SpaceProvider({ spaceKey, children }: { spaceKey: string; children: ReactNode }) {
  const [space, setSpace] = useState<Space | null>(null)

  useEffect(() => {
    const s = createSpace(RELAY_URL, parseKey(spaceKey))
    setSpace(s)
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      s.reconnectNow()
      void s.refreshShells()
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void s.refreshShells()
    }, SHELLS_EVERY_MS)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      s.close()
    }
  }, [spaceKey])

  return space ? <SpaceContext.Provider value={space}>{children}</SpaceContext.Provider> : null
}

export function useSpace(): Space {
  const space = useContext(SpaceContext)
  if (!space) throw new Error('useSpace outside SpaceProvider')
  return space
}

export function useSpaceView(): SpaceView {
  const space = useSpace()
  return useSyncExternalStore(space.subscribe, space.getSnapshot)
}

export function useProjects(): Project[] {
  const view = useSpaceView()
  const { seen } = useLocal()
  return useMemo(
    () => deriveProjects(view.machines, view.shells, seen, view.repos, view.recorded),
    [view.machines, view.shells, seen, view.repos, view.recorded],
  )
}
