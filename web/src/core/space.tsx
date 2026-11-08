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
import { listedPaths, projectActions } from '../model/project-config'
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
      s.refreshUnreadLists()
    }
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void s.refreshShells()
      s.refreshUnreadLists()
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
        view.titles,
      ),
    [view.machines, view.shells, seen, view.repos, view.recorded, view.configs, projectPaths, view.titles],
  )
}

/** Keeps what the machines list, for while they are offline. */
export function useKeepListedPaths() {
  const { configs } = useSpaceView()
  useEffect(() => {
    updateLocal(l => ({ projectPaths: listedPaths(configs, l.projectPaths) }))
  }, [configs])
}

/** Has a machine that lists nothing yet start from where its panes run, as soon as it has any. */
export function useStartProjectLists(projects: Project[]) {
  const space = useSpace()
  const view = useSpaceView()
  const started = useRef(new Set<string>())
  useEffect(() => {
    if (!projectsSettled(view)) return
    for (const entry of view.machines) {
      const mid = entry.state.machine.id
      const mine = projects.filter(p => p.mid === mid)
      const { start } = projectActions(entry, view.configs[mid], view.shellsKnown.has(mid), mine)
      if (!start || started.current.has(mid)) continue
      started.current.add(mid)
      space
        .changeProjects(mid, listed => (listed ? undefined : start))
        .catch((err: unknown) => console.warn('could not write the projects listed', mid, err))
        .finally(() => started.current.delete(mid))
    }
  }, [space, view, projects])
}
