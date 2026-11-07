import { describe, expect, test } from 'vitest'
import { addressTo } from './address'

const at = (pathname: string, search = '') => ({ pathname, search })

describe('addressTo', () => {
  test('an address of a file opens it in a tab, with the tree at its directory', () => {
    expect(addressTo(at('/p/k/files/docs/a%20b.md'), null, undefined)).toBe(
      '/p/k/files/docs/?tab=file/k/docs/a%20b.md',
    )
    expect(addressTo(at('/p/k@w:1/files/a.md'), null, undefined)).toBe(
      '/p/k@w:1/files?tab=file/k%40w%3A1/a.md',
    )
  })

  test('an address of a directory stays', () => {
    expect(addressTo(at('/p/k/files/docs/'), null, undefined)).toBeUndefined()
    expect(addressTo(at('/p/k/files'), null, undefined)).toBeUndefined()
  })

  test('with a tab open, what was shown stays shown wherever the address goes', () => {
    expect(addressTo(at('/p/k'), null, 'file/k/a.md')).toBe('/p/k?tab=file/k/a.md')
    expect(addressTo(at('/p/k', '?tab=file/k/b.md'), 'file/k/b.md', 'file/k/b.md')).toBeUndefined()
  })
})
