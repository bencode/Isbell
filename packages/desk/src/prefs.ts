// Everything Isbell keeps, all in this browser: the space key, settings, what has been looked at,
// and which agent each project last used. Nothing goes to a server.

import type { Seen } from '@isbell/core'
import { useSyncExternalStore } from 'react'

export type Prefs = {
  notify: boolean
  theme: 'system' | 'light' | 'dark'
  lang: 'system' | 'en' | 'zh'
}

export type Local = {
  key: string | null
  prefs: Prefs
  seen: Seen
  /** Agent kind by project key. */
  lastAgent: Record<string, string>
  /** Agent kinds, most recently used first. */
  recentAgents: string[]
}

const DEFAULTS: Local = {
  key: null,
  prefs: { notify: false, theme: 'system', lang: 'system' },
  seen: {},
  lastAgent: {},
  recentAgents: [],
}

const FIELDS = Object.keys(DEFAULTS) as (keyof Local)[]
const storageKey = (field: keyof Local) => `isbell.${field}`

function read<K extends keyof Local>(field: K): Local[K] {
  try {
    const raw = localStorage.getItem(storageKey(field))
    if (raw === null) return DEFAULTS[field]
    const saved = JSON.parse(raw) as Local[K]
    // Settings saved before a newer setting existed get its default.
    return field === 'prefs' ? ({ ...DEFAULTS.prefs, ...(saved as Prefs) } as Local[K]) : saved
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
