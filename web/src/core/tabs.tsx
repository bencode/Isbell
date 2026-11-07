// The tabs beside the page in one window: which are open (kept in this browser), which one shows
// (the address's `?tab`), and the page beneath them (the address without it). Also what lets a
// reply open a path it mentions: where its paths are read from, and how the page opens one (only a
// computer's does).

import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type Location, type To, useLocation, useNavigate } from 'react-router'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Project } from '../model/projects'
import {
  close,
  drawn,
  keep,
  nextShown,
  pin,
  restore,
  type Tabs,
  tabOf,
  togglePin,
  visit,
  withTab,
} from '../model/tabs'
import { getLocal, updateLocal } from './prefs'

type IsTab = (id: string) => boolean
type TabsScope = { store: StoreApi<Tabs>; isTab: IsTab }

const TabsContext = createContext<TabsScope | null>(null)

const savedTabs = (scope: string | undefined) =>
  scope === undefined ? getLocal().tabs : getLocal().projectTabs[scope]

const saveTabs = (scope: string | undefined, tabs: Tabs) =>
  updateLocal(l => (scope === undefined ? { tabs } : { projectTabs: { ...l.projectTabs, [scope]: tabs } }))

/** The tabs of the window inside it, read back from this browser and saved as they change, and the
 * tab the address shows visited; `isTab` tells which ids name a tab. `scope`: whose tabs they are,
 * where each project has its own; what is inside stays mounted as it changes. */
export function TabsProvider({
  isTab,
  scope,
  children,
}: {
  isTab: IsTab
  scope?: string
  children: ReactNode
}) {
  const stores = useRef(new Map<string | undefined, StoreApi<Tabs>>())
  const kept = stores.current.get(scope)
  const store = kept ?? createStore<Tabs>()(() => restore(savedTabs(scope), isTab))
  if (!kept) stores.current.set(scope, store)
  const value = useMemo(() => ({ store, isTab }), [store, isTab])
  // Before the visit below, so that it is saved.
  useLayoutEffect(() => store.subscribe(tabs => saveTabs(scope, tabs)), [store, scope])
  const active = tabOf(useLocation().search, isTab)
  useEffect(() => store.setState(tabs => visit(tabs, active)), [store, active])
  return <TabsContext value={value}>{children}</TabsContext>
}

function useTabsScope() {
  const scope = useContext(TabsContext)
  if (!scope) throw new Error('A TabsProvider is required.')
  return scope
}

/** The tabs at this address, the one it shows (null: the page), and the one shown last. The address
 * is what shows a tab; the store catches up after, and is drawn meanwhile without losing any. */
export function useTabRoute() {
  const { store, isTab } = useTabsScope()
  const active = tabOf(useLocation().search, isTab)
  const tabs = useStore(store)
  return { open: drawn(tabs, active), active, recent: tabs.used[0] }
}

/** The page beneath the tabs: the address without its tab, kept as the same object while the page
 * stays, so showing a tab and coming back neither remounts the page nor gives it a new history key. */
export function usePageLocation(): Location {
  const location = useLocation()
  const kept = useRef<Location | null>(null)
  const search = withTab(location.search, null)
  const page =
    kept.current?.pathname === location.pathname && kept.current.search === search
      ? kept.current
      : { ...location, search }
  useLayoutEffect(() => {
    kept.current = page
  })
  return page
}

/** Where a tab (or the page, for null) is, pinning, keeping one pinned without showing it, and
 * closing; showing goes through the address. */
export function useTabActions() {
  const { store, isTab } = useTabsScope()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const href = (id: string | null): To => ({ pathname, search: withTab(search, id) })
  return {
    href,
    pin: (id: string) => store.setState(tabs => pin(tabs, id)),
    keep: (id: string) => store.setState(tabs => keep(tabs, id)),
    /** Unpinning may close the preview shown; `id` shows in its place. */
    togglePin: (id: string) => {
      store.setState(tabs => togglePin(tabs, id))
      const shown = tabOf(search, isTab)
      const gone = shown !== null && !store.getState().open.some(tab => tab.id === shown)
      if (gone) navigate(href(id), { replace: true })
    },
    /** Closing the tab shown shows the one beside it, or the page, in its place in the history. */
    close: (id: string, shown: boolean) => {
      const next = nextShown(store.getState(), id)
      store.setState(tabs => close(tabs, id))
      if (shown) navigate(href(next), { replace: true })
    },
  }
}

/** Whether `id` is open and pinned. */
export function usePinned(id: string): boolean {
  const { store } = useTabsScope()
  return useStore(store, tabs => tabs.open.some(tab => tab.id === id && tab.pinned))
}

/** Opens a path under the root `key` names: a file in a tab, a directory in the project's files. */
export type OpenPath = (key: string, rel: string, dir: boolean) => void
export const FileOpener = createContext<OpenPath | null>(null)

/** The project a reply's paths lead into, read from the agent's directory. */
export const PathRoot = createContext<{ project: Project; cwd: string } | null>(null)
