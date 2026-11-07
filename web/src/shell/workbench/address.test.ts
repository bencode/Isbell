import { describe, expect, test } from 'vitest'
import { addressTo } from './address'

const nothing = { home: undefined, active: null, recent: undefined }
const at = (pathname: string, search = '') => ({ pathname, search })

describe('addressTo', () => {
  test('the workbench opens where it was left, once that is known', () => {
    expect(addressTo(at('/'), { ...nothing, home: '/p/k?tab=file/k/a' })).toBe('/p/k?tab=file/k/a')
    expect(addressTo(at('/'), nothing)).toBeUndefined()
  })

  test('an address of a file opens it in a tab, with the tree at its directory', () => {
    expect(addressTo(at('/p/k/files/docs/a%20b.md'), nothing)).toBe(
      '/p/k/files/docs/?tab=file/k/docs/a%20b.md',
    )
    expect(addressTo(at('/p/k@w:1/files/a.md'), nothing)).toBe('/p/k@w:1/files?tab=file/k%40w%3A1/a.md')
  })

  test('an address of a directory stays', () => {
    expect(addressTo(at('/p/k/files/docs/'), nothing)).toBeUndefined()
    expect(addressTo(at('/p/k/files'), nothing)).toBeUndefined()
  })

  test('with a tab open, what was shown stays shown wherever the address goes', () => {
    const open = { ...nothing, recent: 'file/k/a.md' }
    expect(addressTo(at('/p/k'), open)).toBe('/p/k?tab=file/k/a.md')
    expect(addressTo(at('/p/k', '?tab=file/k/b.md'), { ...open, active: 'file/k/b.md' })).toBeUndefined()
  })
})
