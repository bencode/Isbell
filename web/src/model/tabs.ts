// The tabs beside the page: things opened over it, each named by an id that reads as a path
// (`file/<project>/<rel>`), the one shown named in the address as `?tab=<id>`. One tab at a time is
// a preview, replaced by the next one opened; a pinned tab stays until closed. At most MAX_TABS are
// open: one more closes the one shown longest ago, never the one being shown.

export type TabEntry = { id: string; pinned: boolean }

/** `used`: the open ids, most recently shown first. */
export type Tabs = { open: TabEntry[]; used: string[] }

export const MAX_TABS = 7

export const noTabs: Tabs = { open: [], used: [] }

/** The tabs with `active` shown (null: the page): a tab not open becomes the preview, in the place
 * of the one there is. Showing the same again changes nothing. */
export function visit(tabs: Tabs, active: string | null): Tabs {
  if (active === null || tabs.used[0] === active) return tabs
  const used = [active, ...tabs.used.filter(id => id !== active)]
  if (tabs.open.some(tab => tab.id === active)) return { ...tabs, used }
  const tab = { id: active, pinned: false }
  const preview = tabs.open.find(t => !t.pinned)
  const open = preview ? tabs.open.map(t => (t === preview ? tab : t)) : [...tabs.open, tab]
  return trim({ open, used: preview ? used.filter(id => id !== preview.id) : used }, active)
}

/** The tabs to draw while `visit` is still to be saved (the address changes in a transition, the
 * store at once): `active` where it will stand if it is not open, and none taken away, so nothing
 * unmounts until the store says so. */
export function drawn(tabs: Tabs, active: string | null): TabEntry[] {
  if (active === null || tabs.open.some(tab => tab.id === active)) return tabs.open
  const at = tabs.open.findIndex(tab => !tab.pinned)
  const tab = { id: active, pinned: false }
  return at < 0 ? [...tabs.open, tab] : [...tabs.open.slice(0, at), tab, ...tabs.open.slice(at)]
}

export const pin = (tabs: Tabs, id: string): Tabs => ({
  ...tabs,
  open: tabs.open.map(tab => (tab.id === id ? { ...tab, pinned: true } : tab)),
})

export const close = (tabs: Tabs, id: string): Tabs => ({
  open: tabs.open.filter(tab => tab.id !== id),
  used: tabs.used.filter(k => k !== id),
})

/** The tab to show on closing the shown `id`: the one to its right, else to its left, else null for
 * the page. */
export function nextShown(tabs: Tabs, id: string): string | null {
  const at = tabs.open.findIndex(tab => tab.id === id)
  return (tabs.open[at + 1] ?? tabs.open[at - 1])?.id ?? null
}

function trim(tabs: Tabs, active: string): Tabs {
  if (tabs.open.length <= MAX_TABS) return tabs
  const oldest = tabs.used.filter(id => id !== active).at(-1)
  return oldest === undefined ? tabs : trim(close(tabs, oldest), active)
}

const isEntry = (v: unknown): v is TabEntry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { id?: unknown }).id === 'string' &&
  typeof (v as { pinned?: unknown }).pinned === 'boolean'

/** Tabs as kept in this browser, read back: entries that are tabs still, once each, at most one
 * preview and MAX_TABS in all. */
export function restore(saved: unknown, isTab: (id: string) => boolean): Tabs {
  const { open, used } = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  const entries = (Array.isArray(open) ? open : []).filter(isEntry).filter(tab => isTab(tab.id))
  const kept = entries
    .filter((tab, i) => entries.findIndex(t => t.id === tab.id) === i)
    .filter((tab, i, all) => tab.pinned || all.findIndex(t => !t.pinned) === i)
    .slice(0, MAX_TABS)
  const ids = kept.map(tab => tab.id)
  const order = (Array.isArray(used) ? used : []).filter((id): id is string => ids.includes(id))
  return { open: kept, used: [...new Set([...order, ...ids])] }
}

const TAB = 'tab'

/** The tab an address's query shows, or null. */
export function tabOf(search: string, isTab: (id: string) => boolean): string | null {
  const id = new URLSearchParams(search).get(TAB)
  return id !== null && isTab(id) ? id : null
}

/** The query `search` with its tab set to `id`, or taken out for null. The id goes last, each of its
 * segments encoded and its '/' kept, so it reads as the path it is. */
export function withTab(search: string, id: string | null): string {
  const rest = new URLSearchParams(search)
  rest.delete(TAB)
  const tab = id === null ? '' : `${TAB}=${id.split('/').map(encodeURIComponent).join('/')}`
  const query = [rest.toString(), tab].filter(Boolean).join('&')
  return query ? `?${query}` : ''
}
