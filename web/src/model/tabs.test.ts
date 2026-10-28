import { describe, expect, it } from 'vitest'
import { closeTab, MAX_TABS, noTabs, openTab, pinTab, showTab, type Tabs, tabKey } from './tabs'

const rels = (tabs: Tabs) => tabs.open.map(tab => tab.rel)
const openAll = (tabs: Tabs, files: string[]) => files.reduce((acc, rel) => openTab(acc, 'p', rel), tabs)
const pinAll = (files: string[]) =>
  files.reduce((acc, rel) => pinTab(openTab(acc, 'p', rel), tabKey('p', rel)), noTabs)

describe('file tabs', () => {
  it('turns the preview to the next file instead of adding a tab', () => {
    const tabs = openAll(noTabs, ['a.ts', 'b.ts'])
    expect(rels(tabs)).toEqual(['b.ts'])
    expect(tabs.active).toBe(tabKey('p', 'b.ts'))
  })

  it('shows a file already open instead of opening it again', () => {
    const tabs = openTab(pinAll(['a.ts', 'b.ts']), 'p', 'a.ts')
    expect(rels(tabs)).toEqual(['a.ts', 'b.ts'])
    expect(tabs.active).toBe(tabKey('p', 'a.ts'))
  })

  it('opens a new preview beside a pinned tab', () => {
    expect(rels(openTab(pinAll(['a.ts']), 'p', 'b.ts'))).toEqual(['a.ts', 'b.ts'])
  })

  it('closes the tab shown longest ago past the limit, never the one shown', () => {
    const files = Array.from({ length: MAX_TABS }, (_, i) => `${i}.ts`)
    // The first opened, shown again, then the page: the second is now the one shown longest ago.
    const full = showTab(showTab(pinAll(files), tabKey('p', '0.ts')), null)
    const tabs = openTab(full, 'p', 'new.ts')
    expect(tabs.open).toHaveLength(MAX_TABS)
    expect(rels(tabs)).not.toContain('1.ts')
    expect(rels(tabs)).toContain('0.ts')
    expect(tabs.active).toBe(tabKey('p', 'new.ts'))
  })

  it('shows the page on closing the tab shown', () => {
    const tabs = openTab(noTabs, 'p', 'a.ts')
    const closed = closeTab(tabs, tabKey('p', 'a.ts'))
    expect(closed.open).toEqual([])
    expect(closed.active).toBeNull()
  })
})
