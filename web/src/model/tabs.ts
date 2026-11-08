// The tabs of a workspace, each named by an id that reads as a path, its kind first
// (`file/<project>/<rel>`), the one shown named in the address as `?tab=<id>`. One tab of each kind
// is a preview, replaced by the next of its kind opened; a pinned tab stays until closed. At most
// MAX_TABS are open: one more closes the one shown longest ago, never the one being shown.

/** `query`: the tab's own part of the address, kept while another tab shows (e.g. `view=terminal`). */
export type TabEntry = { id: string; pinned: boolean; query?: string }

/** `used`: the open ids, most recently shown first. */
export type Tabs = { open: TabEntry[]; used: string[] }

export const MAX_TABS = 7

export const noTabs: Tabs = { open: [], used: [] }

/** A session's tab, or a shell's, by its machine and pane. */
export const sessionTabId = (mid: string, paneId: string) => `session/${mid}/${paneId}`

/** A session's or a shell's tab shows its terminal by `view=terminal` in its part of the address;
 * without it, an agent's shows its chat. */
export const showsTerminal = (query: string) => new URLSearchParams(query).get('view') === 'terminal'

/** `query` with the terminal shown or not, the rest of it as it was. */
export function withTerminal(query: string, on: boolean): string {
  const params = new URLSearchParams(query)
  if (on) params.set('view', 'terminal')
  else params.delete('view')
  return params.toString()
}

/** What tab `id` had of the address when last shown. */
export const keptQuery = (open: TabEntry[], id: string | null | undefined) =>
  open.find(tab => tab.id === id)?.query ?? ''

/** A session that ran, by its machine, its agent and its id. */
export const closedTabId = (mid: string, agent: string, id: string) => `closed/${mid}/${agent}/${id}`

/** One preview for each kind; a session that ran shows in the place of a running one. */
const previewKind = (id: string) => {
  const kind = id.slice(0, id.indexOf('/'))
  return kind === 'closed' ? 'session' : kind
}

/** The preview of the kind of `id`, if there is one. */
const previewFor = (open: TabEntry[], id: string) =>
  open.find(tab => !tab.pinned && previewKind(tab.id) === previewKind(id))

/** An entry with its own part of the address, none when it is empty. */
const withQuery = (tab: TabEntry, query: string): TabEntry => {
  const { query: _was, ...rest } = tab
  return query ? { ...rest, query } : rest
}

/** The tabs with `active` shown (null: none named) as `query` has it: a tab not open becomes its
 * kind's preview, in the place of the one there is. Showing the same again changes nothing. */
export function visit(tabs: Tabs, active: string | null, query = ''): Tabs {
  if (active === null) return tabs
  const entry = tabs.open.find(tab => tab.id === active)
  if (tabs.used[0] === active && (entry?.query ?? '') === query) return tabs
  const used = [active, ...tabs.used.filter(id => id !== active)]
  if (entry) return { open: tabs.open.map(tab => (tab === entry ? withQuery(tab, query) : tab)), used }
  const tab = withQuery({ id: active, pinned: false }, query)
  const preview = previewFor(tabs.open, active)
  const open = preview ? tabs.open.map(t => (t === preview ? tab : t)) : [...tabs.open, tab]
  return trim({ open, used: preview ? used.filter(id => id !== preview.id) : used }, active)
}

/** The tabs to draw while `visit` is still to be saved (the address changes in a transition, the
 * store at once): `active` where it will stand if it is not open, and none taken away, so nothing
 * unmounts until the store says so. */
export function drawn(tabs: Tabs, active: string | null): TabEntry[] {
  if (active === null || tabs.open.some(tab => tab.id === active)) return tabs.open
  const preview = previewFor(tabs.open, active)
  const at = preview ? tabs.open.indexOf(preview) : -1
  const tab = { id: active, pinned: false }
  return at < 0 ? [...tabs.open, tab] : [...tabs.open.slice(0, at), tab, ...tabs.open.slice(at)]
}

export const pin = (tabs: Tabs, id: string): Tabs => ({
  ...tabs,
  open: tabs.open.map(tab => (tab.id === id ? { ...tab, pinned: true } : tab)),
})

/** Pins `id`, or unpins it: it is its kind's preview again, and a kind has one, so the other goes. */
export function togglePin(tabs: Tabs, id: string): Tabs {
  if (!tabs.open.some(tab => tab.id === id && tab.pinned)) return pin(tabs, id)
  const other = previewFor(tabs.open, id)
  const rest = other ? close(tabs, other.id) : tabs
  return { ...rest, open: rest.open.map(tab => (tab.id === id ? { ...tab, pinned: false } : tab)) }
}

/** The tabs with `id` pinned, opened if it is not, without showing it. It counts as just shown, so
 * one more than MAX_TABS closes another: the one shown longest ago. */
export function keep(tabs: Tabs, id: string): Tabs {
  if (tabs.open.some(tab => tab.id === id)) return pin(tabs, id)
  return trim({ open: [...tabs.open, { id, pinned: true }], used: [id, ...tabs.used] }, id)
}

/** `to` in the place of `from`, pinned as it was and as recently shown, without what `from` had of
 * the address; only closes `from` when `to` is open already. */
export function replace(tabs: Tabs, from: string, to: string): Tabs {
  if (tabs.open.some(tab => tab.id === to)) return close(tabs, from)
  return {
    open: tabs.open.map(tab => (tab.id === from ? { id: to, pinned: tab.pinned } : tab)),
    used: tabs.used.map(id => (id === from ? to : id)),
  }
}

export const close = (tabs: Tabs, id: string): Tabs => ({
  open: tabs.open.filter(tab => tab.id !== id),
  used: tabs.used.filter(k => k !== id),
})

/** The tab to show on closing the shown `id`: the one to its right, else to its left, else null for
 * none left. */
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
  typeof (v as { pinned?: unknown }).pinned === 'boolean' &&
  ((v as { query?: unknown }).query === undefined || typeof (v as { query?: unknown }).query === 'string')

/** Tabs as kept in this browser, read back: entries that are tabs still, once each, at most one
 * preview of each kind and MAX_TABS in all. */
export function restore(saved: unknown, isTab: (id: string) => boolean): Tabs {
  const { open, used } = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  const entries = (Array.isArray(open) ? open : []).filter(isEntry).filter(tab => isTab(tab.id))
  const kept = entries
    .filter((tab, i) => entries.findIndex(t => t.id === tab.id) === i)
    .filter((tab, _, all) => tab.pinned || previewFor(all, tab.id) === tab)
    .slice(0, MAX_TABS)
  const ids = kept.map(tab => tab.id)
  const order = (Array.isArray(used) ? used : []).filter((id): id is string => ids.includes(id))
  return { open: kept, used: [...new Set([...order, ...ids])] }
}

const TAB = 'tab'
const PEEK = 'peek'
const PEEK_VIEW = 'peek-view'

/** A session looked at over the workspace, which belongs to no tab. */
export type Peek = { mid: string; paneId: string; terminal: boolean }

/** The session the address looks at, if any. A machine's id holds no '/'; a pane's may. */
export function peekOf(search: string): Peek | null {
  const params = new URLSearchParams(search)
  const at = params.get(PEEK) ?? ''
  const cut = at.indexOf('/')
  if (cut <= 0 || cut === at.length - 1) return null
  return {
    mid: at.slice(0, cut),
    paneId: at.slice(cut + 1),
    terminal: params.get(PEEK_VIEW) === 'terminal',
  }
}

/** The query `search` looking at `peek`, or at nothing for null. */
export function withPeek(search: string, peek: Peek | null): string {
  const rest = new URLSearchParams(search)
  const tab = rest.get(TAB)
  for (const key of [TAB, PEEK, PEEK_VIEW]) rest.delete(key)
  if (peek) rest.set(PEEK, `${peek.mid}/${peek.paneId}`)
  if (peek?.terminal) rest.set(PEEK_VIEW, 'terminal')
  return withTab(rest.toString(), tab)
}

export const withoutPeek = (search: string) => withPeek(search, null)

/** The tab an address's query shows, or null. */
export function tabOf(search: string, isTab: (id: string) => boolean): string | null {
  const id = new URLSearchParams(search).get(TAB)
  return id !== null && isTab(id) ? id : null
}

/** The address's query without its tab: the shown tab's own. */
export function queryOf(search: string): string {
  const rest = new URLSearchParams(search)
  for (const key of [TAB, PEEK, PEEK_VIEW]) rest.delete(key)
  return rest.toString()
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
