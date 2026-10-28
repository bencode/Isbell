// The file tabs, one set for the whole window, and the pinned ones kept for the next visit. Also
// what lets a reply open a path it mentions: where its paths are read from, and how the page
// opens one (only a computer's does).

import { createContext, useSyncExternalStore } from 'react'
import type { Project } from '../model/projects'
import * as model from '../model/tabs'
import { getLocal, updateLocal } from './prefs'

const isPinned = (v: unknown): v is { project: string; rel: string } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { project?: unknown }).project === 'string' &&
  typeof (v as { rel?: unknown }).rel === 'string'

const saved: unknown = getLocal().tabs
let tabs = model.restoreTabs(Array.isArray(saved) ? saved.filter(isPinned) : [])
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function set(next: model.Tabs) {
  const pinned = model.pinnedOf(next)
  const before = model.pinnedOf(tabs)
  tabs = next
  if (
    pinned.length !== before.length ||
    pinned.some((p, i) => p.project !== before[i]?.project || p.rel !== before[i]?.rel)
  )
    updateLocal(() => ({ tabs: pinned }))
  for (const listener of listeners) listener()
}

export const useTabs = () => useSyncExternalStore(subscribe, () => tabs)

export const openTab = (project: string, rel: string) => set(model.openTab(tabs, project, rel))
export const showTab = (key: string | null) => set(model.showTab(tabs, key))
export const pinTab = (key: string) => set(model.pinTab(tabs, key))
export const closeTab = (key: string) => set(model.closeTab(tabs, key))

/** Opens a path in a project: a file in a tab, a directory in the project's files. */
export type OpenPath = (project: Project, rel: string, dir: boolean) => void
export const FileOpener = createContext<OpenPath | null>(null)

/** The project a reply's paths lead into, read from the agent's directory. */
export const PathRoot = createContext<{ project: Project; cwd: string } | null>(null)
