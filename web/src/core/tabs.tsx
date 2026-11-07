// The tabs of a project's workspace: which are open (kept in this browser, each project its own),
// and which one shows (the address's `?tab`).

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { type To, useLocation, useNavigate } from 'react-router'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  close,
  drawn,
  keep,
  nextShown,
  replace,
  restore,
  type Tabs,
  tabOf,
  togglePin,
  visit,
  withTab,
} from '../model/tabs'
import { rememberTabs, tabsOf } from './prefs'

type IsTab = (id: string) => boolean
type TabsScope = { store: StoreApi<Tabs>; isTab: IsTab }

const TabsContext = createContext<TabsScope | null>(null)

/** The tabs of the project `scope` names, read back from this browser and saved as they change, and
 * the tab the address shows visited; `isTab` tells which ids name a tab. Each project keeps its
 * store for the page's life, so what is inside stays mounted going between projects. */
export function TabsProvider({
  isTab,
  scope,
  children,
}: {
  isTab: IsTab
  scope: string
  children: ReactNode
}) {
  const [stores] = useState(() => new Map<string, StoreApi<Tabs>>())
  const store = stores.get(scope) ?? createStore<Tabs>()(() => restore(tabsOf(scope), isTab))
  stores.set(scope, store)
  const value = useMemo(() => ({ store, isTab }), [store, isTab])
  // Before the visit below, so that it is saved.
  useLayoutEffect(() => store.subscribe(tabs => rememberTabs(scope, tabs)), [store, scope])
  const active = tabOf(useLocation().search, isTab)
  useEffect(() => store.setState(tabs => visit(tabs, active)), [store, active])
  return <TabsContext value={value}>{children}</TabsContext>
}

function useTabsScope() {
  const scope = useContext(TabsContext)
  if (!scope) throw new Error('A TabsProvider is required.')
  return scope
}

/** The tabs at this address, the one it names (null: none), and the one shown: that one, else, while
 * the address is on its way to one, the one shown last. The store catches up with the address after,
 * and is drawn meanwhile without losing any. */
export function useTabRoute() {
  const { store, isTab } = useTabsScope()
  const active = tabOf(useLocation().search, isTab)
  const tabs = useStore(store)
  return { open: drawn(tabs, active), active, shown: active ?? tabs.used[0] }
}

/** Where a tab is, keeping one pinned without showing it, pinning and closing; showing goes through
 * the address. */
export function useTabActions() {
  const { store, isTab } = useTabsScope()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  // The same while the address stays, so effects can depend on them.
  return useMemo(() => {
    const href = (id: string | null): To => ({ pathname, search: withTab(search, id) })
    return {
      href,
      keep: (id: string) => store.setState(tabs => keep(tabs, id)),
      /** Unpinning may close the preview shown; `id` shows in its place. */
      togglePin: (id: string) => {
        store.setState(tabs => togglePin(tabs, id))
        const shown = tabOf(search, isTab)
        const gone = shown !== null && !store.getState().open.some(tab => tab.id === shown)
        if (gone) navigate(href(id), { replace: true })
      },
      /** `to` in the place of `from`, shown in its place in the history if `from` was; `state` for
       * the address that shows it. */
      replace: (from: string, to: string, state?: unknown) => {
        store.setState(tabs => replace(tabs, from, to))
        if (tabOf(search, isTab) === from) navigate(href(to), { replace: true, state })
      },
      /** Closing the tab shown shows the one beside it, or none, in its place in the history. */
      close: (id: string, shown: boolean) => {
        const next = nextShown(store.getState(), id)
        store.setState(tabs => close(tabs, id))
        if (shown) navigate(href(next), { replace: true })
      },
    }
  }, [store, isTab, pathname, search, navigate])
}
