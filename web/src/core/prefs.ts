// Everything Isbell keeps, all in this browser: the space key, settings, what has been looked at,
// and where each project was left. Nothing goes to a server.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_APPEARANCE,
  type ReadingAppearance,
  readingAppearance,
} from '../components/renderers/markdown/appearance'
import type { Seen } from '../model/projects'
import type { Tabs } from '../model/tabs'

export type Prefs = {
  notify: boolean
  /** Pushes to this iPhone, with Isbell closed (core/push). */
  push: boolean
  theme: 'system' | 'light' | 'dark'
  lang: 'system' | 'en' | 'zh'
}

export type Layout = {
  /** The projects column shrunk to a rail of tiles. */
  rail: boolean
  /** The folders open in each files tree (relative to its root), by root key: a project's own key
   * for its directory, or another worktree's. */
  files: Record<string, string[]>
  /** Where each project's files were last read, by project key: the root's key and the directory
   * under it, ending in '/' ('' for the root). */
  filesAt: Record<string, { root: string; rel: string }>
  /** Whether long lines of source wrap. */
  wrap: boolean
  /** The same on a phone, where they wrap unless told otherwise. */
  wrapOnPhone: boolean
  /** Which sessions the right column shows. */
  activeFilter: 'all' | 'blocked' | 'working' | 'idle'
  /** Whether those standing by are unfolded there. */
  idleOpen: boolean
}

/** How documents read in the files view. */
export type Reader = ReadingAppearance & {
  /** The outline shown beside a document, where there is room for it. */
  outline: boolean
}

export type Local = {
  key: string | null
  prefs: Prefs
  seen: Seen
  layout: Layout
  reader: Reader
  /** The tabs open in each project, by project key, read back by `restore` in model/tabs. */
  projectTabs: Record<string, Tabs>
  /** Where each project was last left, as an address, by project key. */
  projectAt: Record<string, string>
  /** The project last looked at. */
  lastProject: string | null
  /** The agent last started on a phone. */
  lastAgent: string | null
  /** What each machine last listed as its projects, by machine id, for while it is offline. */
  projectPaths: Record<string, string[]>
}

const DEFAULTS: Local = {
  key: null,
  prefs: { notify: false, push: false, theme: 'system', lang: 'system' },
  seen: {},
  layout: {
    rail: false,
    files: {},
    filesAt: {},
    wrap: false,
    wrapOnPhone: true,
    activeFilter: 'all',
    idleOpen: false,
  },
  reader: { ...DEFAULT_APPEARANCE, outline: true },
  projectTabs: {},
  projectAt: {},
  lastProject: null,
  lastAgent: null,
  projectPaths: {},
}

const FIELDS = Object.keys(DEFAULTS) as (keyof Local)[]
const storageKey = (field: keyof Local) => `isbell.${field}`

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function read<K extends keyof Local>(field: K): Local[K] {
  try {
    const raw = localStorage.getItem(storageKey(field))
    if (raw === null) return DEFAULTS[field]
    const saved: unknown = JSON.parse(raw)
    // Settings saved before a newer setting existed get its default.
    const fallback: unknown = DEFAULTS[field]
    return (isRecord(fallback) && isRecord(saved) ? { ...fallback, ...saved } : saved) as Local[K]
  } catch (err) {
    console.warn(`could not read ${field}; using the default`, err)
    return DEFAULTS[field]
  }
}

function write(field: keyof Local, value: unknown) {
  try {
    localStorage.setItem(storageKey(field), JSON.stringify(value))
  } catch (err) {
    console.warn(`could not save ${field}`, err)
  }
}

const loaded = Object.fromEntries(FIELDS.map(f => [f, read(f)])) as Local
// The reading settings are checked one by one: an old or broken value falls back alone.
const savedReader: Record<string, unknown> = isRecord(loaded.reader) ? loaded.reader : {}
let current: Local = {
  ...loaded,
  reader: { ...readingAppearance(savedReader), outline: savedReader.outline !== false },
}
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Applies `change` and saves the fields it touched. */
export function updateLocal(change: (l: Local) => Partial<Local>) {
  const patch = change(current)
  current = { ...current, ...patch }
  for (const field of Object.keys(patch) as (keyof Local)[]) write(field, current[field])
  for (const listener of listeners) listener()
}

const getLocal = () => current

export const setActiveFilter = (activeFilter: Layout['activeFilter']) =>
  updateLocal(l => ({ layout: { ...l.layout, activeFilter } }))

export const toggleIdle = () => updateLocal(l => ({ layout: { ...l.layout, idleOpen: !l.layout.idleOpen } }))

export const toggleRail = () => updateLocal(l => ({ layout: { ...l.layout, rail: !l.layout.rail } }))

const withOpenDirs = (project: string, change: (dirs: string[]) => string[]) =>
  updateLocal(l => ({
    layout: { ...l.layout, files: { ...l.layout.files, [project]: change(l.layout.files[project] ?? []) } },
  }))

/** Opens or closes a folder in a files tree, by its root's key. */
export const toggleDir = (root: string, dir: string) =>
  withOpenDirs(root, dirs => (dirs.includes(dir) ? dirs.filter(d => d !== dir) : [...dirs, dir]))

/** Opens these folders in a files tree, by its root's key, keeping the ones already open. */
export function openDirs(root: string, wanted: string[]) {
  const open = getLocal().layout.files[root]
  // Opening a file whose folders are open already saves nothing.
  if (open && wanted.every(d => open.includes(d))) return
  withOpenDirs(root, dirs => [...dirs, ...wanted.filter(d => !dirs.includes(d))])
}

/** Notes where the workbench stands in a project, as the project looked at last. */
export function rememberProjectAt(project: string, at: string) {
  if (current.lastProject === project && current.projectAt[project] === at) return
  updateLocal(l => ({ lastProject: project, projectAt: { ...l.projectAt, [project]: at } }))
}

/** The tabs a project was left with. */
export const tabsOf = (project: string): Tabs | undefined => current.projectTabs[project]

export const rememberTabs = (project: string, tabs: Tabs) =>
  updateLocal(l => ({ projectTabs: { ...l.projectTabs, [project]: tabs } }))

/** Notes where a project's files are being read. */
export function rememberFilesAt(project: string, root: string, rel: string) {
  const at = current.layout.filesAt[project]
  if (at?.root === root && at.rel === rel) return
  updateLocal(l => ({ layout: { ...l.layout, filesAt: { ...l.layout.filesAt, [project]: { root, rel } } } }))
}

export const toggleWrap = () => updateLocal(l => ({ layout: { ...l.layout, wrap: !l.layout.wrap } }))

export const toggleWrapOnPhone = () =>
  updateLocal(l => ({ layout: { ...l.layout, wrapOnPhone: !l.layout.wrapOnPhone } }))

export const setReader = (change: Partial<Reader>) =>
  updateLocal(l => ({ reader: { ...l.reader, ...change } }))

/** Notes that a finished session was seen as it stood at `since`, which makes it read. */
export function markSeen(key: string, since: number) {
  if ((current.seen[key] ?? 0) >= since) return
  updateLocal(l => ({ seen: { ...l.seen, [key]: since } }))
}

export const useLocal = () => useSyncExternalStore(subscribe, getLocal)

/** Leaving the space forgets everything, what older versions kept too. */
export function clearLocal() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('isbell.')) localStorage.removeItem(key)
  } catch (err) {
    console.warn('could not forget what was kept', err)
  }
  current = DEFAULTS
  for (const listener of listeners) listener()
}

export function applyTheme(theme: Prefs['theme']) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
