// Everything Isbell keeps, all in this browser: the space key, settings, what has been looked at,
// and which agent each project last used. Nothing goes to a server.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_APPEARANCE,
  type ReadingAppearance,
  readingAppearance,
} from '../components/renderers/markdown/appearance'
import { projectKey, type Seen } from '../model/projects'
import { noTabs, type Tabs } from '../model/tabs'

export type Prefs = {
  notify: boolean
  theme: 'system' | 'light' | 'dark'
  lang: 'system' | 'en' | 'zh'
}

export type Layout = {
  /** The sidebar shrunk to a rail of icons. */
  rail: boolean
  /** Machine ids whose projects are hidden in the sidebar; any other machine shows them. Keys saved
   * when it held projects never match a machine id, so they fold nothing. */
  folded: string[]
  /** Agent panes (by paneKey) last seen in their terminal, most recent first; any other opens in chat. */
  terminal: string[]
  /** The folders open in each files tree (relative to its root), by root key: a project's own key
   * for its directory, or another worktree's. */
  files: Record<string, string[]>
  /** The worktrees open in each project's files tree, by root key, by project key; without one,
   * just the project's own directory. */
  branches: Record<string, string[]>
  /** Whether long lines of source wrap. */
  wrap: boolean
  /** Whether the agents standing by that have long been still show, at the foot of their lane. */
  stale: boolean
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
  /** Agent kind by project key. */
  lastAgent: Record<string, string>
  /** Agent kinds, most recently used first. */
  recentAgents: string[]
  layout: Layout
  reader: Reader
  /** The tabs open beside the page, read back by `restore` in model/tabs. */
  tabs: Tabs
}

const DEFAULTS: Local = {
  key: null,
  prefs: { notify: false, theme: 'system', lang: 'system' },
  seen: {},
  lastAgent: {},
  recentAgents: [],
  layout: {
    rail: false,
    folded: [],
    terminal: [],
    files: {},
    branches: {},
    wrap: false,
    stale: false,
  },
  reader: { ...DEFAULT_APPEARANCE, outline: true },
  tabs: noTabs,
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
// Project keys were `mid:path` once (a root key may hold ':', but never before an absolute path);
// what was kept by them moves to the keys the same projects have now.
const LEGACY_KEY = /^([^@:]+):(\/.*)$/
const rekeyed = <T>(byProject: Record<string, T>) =>
  Object.fromEntries(
    Object.entries(byProject).map(([key, value]) => {
      const legacy = LEGACY_KEY.exec(key)
      return [legacy ? projectKey(legacy[1] ?? '', legacy[2] ?? '') : key, value]
    }),
  )
let current: Local = {
  ...loaded,
  lastAgent: rekeyed(loaded.lastAgent),
  layout: { ...loaded.layout, files: rekeyed(loaded.layout.files) },
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

export const getLocal = () => current

export const toggleRail = () => updateLocal(l => ({ layout: { ...l.layout, rail: !l.layout.rail } }))

/** Shows or hides a machine's projects in the sidebar. */
export const toggleFolded = (key: string) =>
  updateLocal(l => {
    const { folded } = l.layout
    return {
      layout: {
        ...l.layout,
        folded: folded.includes(key) ? folded.filter(k => k !== key) : [...folded, key],
      },
    }
  })

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

/** The worktrees open in a project's files tree, by root key. */
export const openBranches = (layout: Layout, project: string) => layout.branches[project] ?? [project]

const withOpenBranches = (project: string, change: (open: string[]) => string[]) =>
  updateLocal(l => ({
    layout: {
      ...l.layout,
      branches: { ...l.layout.branches, [project]: change(openBranches(l.layout, project)) },
    },
  }))

/** Opens or closes a worktree in a project's files tree. */
export const toggleBranch = (project: string, root: string) =>
  withOpenBranches(project, open => (open.includes(root) ? open.filter(r => r !== root) : [...open, root]))

/** Opens a worktree in a project's files tree. */
export function openBranch(project: string, root: string) {
  if (!openBranches(getLocal().layout, project).includes(root))
    withOpenBranches(project, open => [...open, root])
}

export const toggleWrap = () => updateLocal(l => ({ layout: { ...l.layout, wrap: !l.layout.wrap } }))
export const toggleStale = () => updateLocal(l => ({ layout: { ...l.layout, stale: !l.layout.stale } }))

export const setReader = (change: Partial<Reader>) =>
  updateLocal(l => ({ reader: { ...l.reader, ...change } }))

/** How many panes keep their terminal view; panes that ended fall off the end. */
const TERMINAL_MAX = 50

/** Notes that a finished session was seen as it stood at `since`, which makes it read. */
export function markSeen(key: string, since: number) {
  if ((current.seen[key] ?? 0) >= since) return
  updateLocal(l => ({ seen: { ...l.seen, [key]: since } }))
}

/** Notes which view an agent's pane was last seen in. */
export function rememberView(key: string, view: 'chat' | 'terminal') {
  const { terminal } = current.layout
  const rest = terminal.filter(k => k !== key)
  const next = view === 'terminal' ? [key, ...rest].slice(0, TERMINAL_MAX) : rest
  if (next.length === terminal.length && next.every((k, i) => k === terminal[i])) return
  updateLocal(l => ({ layout: { ...l.layout, terminal: next } }))
}

export const useLocal = () => useSyncExternalStore(subscribe, getLocal)

/** Leaving the space forgets everything. */
export function clearLocal() {
  for (const field of FIELDS) {
    try {
      localStorage.removeItem(storageKey(field))
    } catch (err) {
      console.warn(`could not remove ${field}`, err)
    }
  }
  current = DEFAULTS
  for (const listener of listeners) listener()
}

export function applyTheme(theme: Prefs['theme']) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
