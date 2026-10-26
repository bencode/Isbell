// Everything Isbell keeps, all in this browser: the space key, settings, what has been looked at,
// and which agent each project last used. Nothing goes to a server.

import { useSyncExternalStore } from 'react'
import type { Seen } from '../model/projects'

export type Prefs = {
  notify: boolean
  theme: 'system' | 'light' | 'dark'
  lang: 'system' | 'en' | 'zh'
}

export type Layout = {
  /** The info panel beside a session or terminal. */
  info: boolean
  /** The sidebar shrunk to a rail of icons. */
  rail: boolean
  /** Project keys whose sessions are hidden in the sidebar; any other project shows them. */
  folded: string[]
  /** Agent panes (by paneKey) last seen in their terminal, most recent first; any other opens in chat. */
  terminal: string[]
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
}

const DEFAULTS: Local = {
  key: null,
  prefs: { notify: false, theme: 'system', lang: 'system' },
  seen: {},
  lastAgent: {},
  recentAgents: [],
  layout: { info: false, rail: false, folded: [], terminal: [] },
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

let current: Local = Object.fromEntries(FIELDS.map(f => [f, read(f)])) as Local
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

/** Shows or hides the info panel, on every page that has one. */
export const toggleInfo = () => updateLocal(l => ({ layout: { ...l.layout, info: !l.layout.info } }))

export const toggleRail = () => updateLocal(l => ({ layout: { ...l.layout, rail: !l.layout.rail } }))

/** Shows or hides a project's sessions in the sidebar. */
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
