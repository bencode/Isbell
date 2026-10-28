// The files open in tabs beside the pages. One tab at a time is a preview, replaced by the next file
// opened; a pinned tab stays until closed. At most MAX_TABS are open: opening one more closes the
// one shown longest ago, never the one being shown.

export type FileTab = { project: string; rel: string; pinned: boolean }

/** `active`: the tab shown, or null for the page. `used`: tab keys, most recently shown first. */
export type Tabs = { open: FileTab[]; active: string | null; used: string[] }

export const MAX_TABS = 7

export const tabKey = (project: string, rel: string) => `${project}\n${rel}`

const keyOf = (tab: FileTab) => tabKey(tab.project, tab.rel)

export const noTabs: Tabs = { open: [], active: null, used: [] }

/** Shows the file's tab: the one it already has, else the preview turned to it, else a new preview. */
export function openTab(tabs: Tabs, project: string, rel: string): Tabs {
  const key = tabKey(project, rel)
  if (tabs.open.some(tab => keyOf(tab) === key)) return showTab(tabs, key)
  const tab = { project, rel, pinned: false }
  const preview = tabs.open.find(t => !t.pinned)
  const open = preview ? tabs.open.map(t => (t === preview ? tab : t)) : [...tabs.open, tab]
  const used = preview ? tabs.used.filter(k => k !== keyOf(preview)) : tabs.used
  return trim(showTab({ open, active: tabs.active, used }, key))
}

/** `key` null shows the page. */
export function showTab(tabs: Tabs, key: string | null): Tabs {
  if (key === null) return { ...tabs, active: null }
  if (!tabs.open.some(tab => keyOf(tab) === key)) return tabs
  return { ...tabs, active: key, used: [key, ...tabs.used.filter(k => k !== key)] }
}

export const pinTab = (tabs: Tabs, key: string): Tabs => ({
  ...tabs,
  open: tabs.open.map(tab => (keyOf(tab) === key ? { ...tab, pinned: true } : tab)),
})

/** Closing the tab shown shows the page. */
export const closeTab = (tabs: Tabs, key: string): Tabs => ({
  open: tabs.open.filter(tab => keyOf(tab) !== key),
  active: tabs.active === key ? null : tabs.active,
  used: tabs.used.filter(k => k !== key),
})

function trim(tabs: Tabs): Tabs {
  if (tabs.open.length <= MAX_TABS) return tabs
  const oldest = tabs.used.filter(k => k !== tabs.active).at(-1)
  return oldest === undefined ? tabs : trim(closeTab(tabs, oldest))
}

/** Pinned tabs as kept between visits, none shown. */
export const restoreTabs = (pinned: { project: string; rel: string }[]): Tabs => {
  const open = pinned.slice(0, MAX_TABS).map(p => ({ ...p, pinned: true }))
  return { open, active: null, used: open.map(keyOf) }
}

export const pinnedOf = (tabs: Tabs) =>
  tabs.open.filter(tab => tab.pinned).map(({ project, rel }) => ({ project, rel }))
