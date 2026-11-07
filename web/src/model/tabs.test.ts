import { describe, expect, it } from 'vitest'
import {
  close,
  drawn,
  keep,
  MAX_TABS,
  nextShown,
  noTabs,
  pin,
  queryOf,
  replace,
  restore,
  showsTerminal,
  type Tabs,
  tabOf,
  togglePin,
  visit,
  withTab,
  withTerminal,
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

  it('keeps a preview for each kind: a file takes the place of a file, never of a session', () => {
    const [fileA, fileB, session] = ['file/k/a', 'file/k/b', 'session/m/p']
    const tabs = visit(visit(noTabs, fileA), session)
    expect(ids(tabs)).toEqual([fileA, session])
    expect(ids(visit(tabs, fileB))).toEqual([fileB, session])
    expect(drawn(tabs, fileB).map(tab => tab.id)).toEqual([fileB, fileA, session])
  })

  it('shows a session that ran in the place of a running one, as both are sessions', () => {
    const [running, ran, file] = ['session/m/p', 'closed/m/pi/s1', 'file/k/a']
    expect(ids(visit(visit(visit(noTabs, running), file), ran))).toEqual([ran, file])
  })

  it('puts a tab in the place of another, pinned as it was; only closes it when that one is open', () => {
    const [ran, running, other] = ['closed/m/pi/s1', 'session/m/p', 'file/k/a']
    const tabs = visit(pinned([ran]), other)
    const replaced = replace(tabs, ran, running)
    expect(replaced.open).toEqual([
      { id: running, pinned: true },
      { id: other, pinned: false },
    ])
    expect(replaced.used).toEqual([other, running])
    expect(ids(replace(visit(pinned([ran]), running), ran, running))).toEqual([running])
  })

  it('pins a tab, and unpinned it is the preview again, in the place of the one there was', () => {
    const [kept, shown, session] = ['file/k/a', 'file/k/b', 'session/m/p']
    const tabs = visit(visit(togglePin(visit(noTabs, kept), kept), shown), session)
    expect(tabs.open).toContainEqual({ id: kept, pinned: true })

    const unpinned = togglePin(tabs, kept)
    expect(unpinned.open).toEqual([
      { id: kept, pinned: false },
      { id: session, pinned: false },
    ])
    expect(unpinned.used).not.toContain(shown)
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

  it("keeps each tab's own part of the address while another shows, and only what is still its own", () => {
    const shown = visit(visit(noTabs, 'session/m/p', 'view=terminal'), 'file/k/a')
    expect(shown.open).toEqual([
      { id: 'session/m/p', pinned: false, query: 'view=terminal' },
      { id: 'file/k/a', pinned: false },
    ])
    const back = visit(shown, 'session/m/p', 'view=terminal')
    expect(visit(back, 'session/m/p', 'view=terminal')).toBe(back)
    expect(visit(back, 'session/m/p').open[0]).toEqual({ id: 'session/m/p', pinned: false })
    // A session that ran in the place of the one running has none of its view.
    expect(replace(back, 'session/m/p', 'closed/m/pi/1').open[0]).toEqual({
      id: 'closed/m/pi/1',
      pinned: false,
    })
    expect(restore(back, any)).toEqual(back)
    expect(restore({ open: [{ id: 'a', pinned: false, query: 1 }] }, any)).toEqual(noTabs)
  })

  it("turns a tab's terminal on and off, leaving the rest of its part of the address", () => {
    const on = withTerminal('x=1', true)
    expect(showsTerminal(on)).toBe(true)
    expect(withTerminal(on, false)).toBe('x=1')
    expect(showsTerminal('')).toBe(false)
  })

  it('reads back a preview of each kind', () => {
    const open = ['file/k/a', 'file/k/b', 'session/m/p'].map(id => ({ id, pinned: false }))
    expect(ids(restore({ open, used: [] }, any))).toEqual(['file/k/a', 'session/m/p'])
  })

  it('names the tab in the query readably, and reads it back as it was', () => {
    const id = 'file/isbell-1x3f9a/web/src/a b#c&d%e+f/中.ts'
    const search = withTab('?x=1', id)
    expect(search.startsWith('?x=1&tab=file/isbell-1x3f9a/web/src/')).toBe(true)
    expect(tabOf(search, any)).toBe(id)
    expect(withTab(search, null)).toBe('?x=1')
    expect(queryOf(search)).toBe('x=1')
    expect(withTab(queryOf(search), id)).toBe(search)
    expect(withTab('', null)).toBe('')
    expect(tabOf(search, () => false)).toBeNull()
  })
})
