import { describe, expect, it } from 'vitest'
import {
  close,
  drawn,
  keep,
  MAX_TABS,
  nextShown,
  noTabs,
  pin,
  restore,
  type Tabs,
  tabOf,
  visit,
  withTab,
} from './tabs'

const ids = (tabs: Tabs) => tabs.open.map(tab => tab.id)
const pinned = (names: string[]) => names.reduce((acc, id) => pin(visit(acc, id), id), noTabs)
const any = () => true

describe('tabs', () => {
  it('shows a tab in the place of the preview, and a pinned one beside it', () => {
    const tabs = visit(visit(noTabs, 'a'), 'b')
    expect(tabs.open).toEqual([{ id: 'b', pinned: false }])
    expect(ids(visit(pinned(['a']), 'b'))).toEqual(['a', 'b'])
  })

  it('shows an open tab where it is, and showing it again changes nothing', () => {
    const tabs = visit(pinned(['a', 'b']), 'a')
    expect(ids(tabs)).toEqual(['a', 'b'])
    expect(tabs.used).toEqual(['a', 'b'])
    expect(visit(tabs, 'a')).toBe(tabs)
    expect(visit(tabs, null)).toBe(tabs)
  })

  it('draws a tab not yet saved where it will stand, taking none away', () => {
    const tabs = visit(pinned(['a']), 'p')
    expect(drawn(tabs, 'b').map(tab => tab.id)).toEqual(['a', 'b', 'p'])
    expect(ids(visit(tabs, 'b'))).toEqual(['a', 'b'])
    expect(drawn(tabs, 'a')).toBe(tabs.open)
  })

  it('closes the tab shown longest ago beyond the limit, never the one shown', () => {
    const names = Array.from({ length: MAX_TABS }, (_, i) => String(i))
    const full = visit(pinned(names), '0')
    const tabs = visit(full, 'new')
    expect(tabs.open).toHaveLength(MAX_TABS)
    expect(ids(tabs)).toContain('0')
    expect(ids(tabs)).toContain('new')
    expect(ids(tabs)).not.toContain('1')
    expect(new Set(tabs.used)).toEqual(new Set(ids(tabs)))
  })

  it('keeps a tab pinned without showing it, beyond the limit closing the one shown longest ago', () => {
    const tabs = visit(pinned(['a']), 'p')
    expect(keep(tabs, 'p').open).toEqual([
      { id: 'a', pinned: true },
      { id: 'p', pinned: true },
    ])
    expect(keep(tabs, 'b').open).toEqual([...tabs.open, { id: 'b', pinned: true }])
    const names = Array.from({ length: MAX_TABS }, (_, i) => String(i))
    const full = keep(pinned(names), 'new')
    expect(full.open).toHaveLength(MAX_TABS)
    expect(ids(full)).toContain('new')
    expect(ids(full)).not.toContain('0')
  })

  it('goes right, else left, else to the page on closing the tab shown', () => {
    const tabs = pinned(['a', 'b', 'c'])
    expect(nextShown(tabs, 'b')).toBe('c')
    expect(nextShown(tabs, 'c')).toBe('b')
    expect(nextShown(close(close(tabs, 'a'), 'b'), 'c')).toBeNull()
  })

  it('reads back only well-formed tabs, once each, with one preview', () => {
    const saved = {
      open: [
        { id: 'a', pinned: true },
        { id: 'a', pinned: true },
        { id: 'x', pinned: false },
        { id: 'y', pinned: false },
        { id: 'gone', pinned: true },
        { id: 3 },
      ],
      used: ['y', 'x', 'a', 'nope'],
    }
    const tabs = restore(saved, id => id !== 'gone')
    expect(tabs.open).toEqual([
      { id: 'a', pinned: true },
      { id: 'x', pinned: false },
    ])
    expect(tabs.used).toEqual(['x', 'a'])
    expect(restore([{ project: 'p', rel: 'a.ts' }], any)).toEqual(noTabs)
  })

  it('names the tab in the query readably, and reads it back as it was', () => {
    const id = 'file/isbell-1x3f9a/web/src/a b#c&d%e+f/中.ts'
    const search = withTab('?x=1', id)
    expect(search.startsWith('?x=1&tab=file/isbell-1x3f9a/web/src/')).toBe(true)
    expect(tabOf(search, any)).toBe(id)
    expect(withTab(search, null)).toBe('?x=1')
    expect(withTab('', null)).toBe('')
    expect(tabOf(search, () => false)).toBeNull()
  })
})
