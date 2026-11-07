// The space connection for the whole app, and the projects derived from it.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { parseKey } from '../model/identity'
import { initialPaths, listedPaths } from '../model/project-config'
import { deriveProjects, type Project } from '../model/projects'
import { createSpace, projectsSettled, type Space, type SpaceView } from '../model/space'
import { updateLocal, useLocal } from './prefs'

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
  const { seen, projectPaths } = useLocal()
  return useMemo(
    () =>
      deriveProjects(
        view.machines,
        view.shells,
        seen,
        view.repos,
        view.recorded,
        listedPaths(view.configs, projectPaths),
      ),
    [view.machines, view.shells, seen, view.repos, view.recorded, view.configs, projectPaths],
  )
}

/** Keeps what the machines list for while they are offline, and has a machine that lists nothing yet
 * start from where its panes run, once. A write that fails is left to the next visit. */
export function useProjectConfigs() {
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const { projectPaths } = useLocal()
  const started = useRef(new Set<string>())
  useEffect(() => {
    const paths = listedPaths(view.configs, projectPaths)
    if (JSON.stringify(paths) !== JSON.stringify(projectPaths)) updateLocal(() => ({ projectPaths: paths }))
  }, [view.configs, projectPaths])
  useEffect(() => {
    if (!projectsSettled(view)) return
    for (const { state, online } of view.machines) {
      const mid = state.machine.id
      const writes = state.caps.methods.includes('isbell.file.write')
      if (!online || !writes || view.configs[mid]?.state !== 'missing' || started.current.has(mid)) continue
      started.current.add(mid)
      const mine = projects.filter(p => p.mid === mid)
      space.saveProjects(mid, initialPaths(mine)).catch((err: unknown) => {
        console.warn('could not write the projects listed', mid, err)
      })
    }
  }, [space, view, projects])
}
