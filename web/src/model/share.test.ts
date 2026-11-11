import { describe, expect, it } from 'vitest'
import { parseShareHash, shareUrl } from './share'

describe('share links', () => {
  it('carry the entry through, whatever its names', () => {
    const entry = 'priv/design 2/首页 #1.html'
    const url = new URL(shareUrl('https://isbell.fmap.dev', 'isbk1-abc', entry))
    expect(url.pathname).toBe('/share')
    expect(parseShareHash(url.hash)).toEqual({ key: 'isbk1-abc', entry })
  })

  it('are not a share without both a key and a file', () => {
    expect(parseShareHash('#isbk1-abc')).toBeUndefined()
    expect(parseShareHash('#isbk1-abc/')).toBeUndefined()
    expect(parseShareHash('#/a.html')).toBeUndefined()
  })
})
