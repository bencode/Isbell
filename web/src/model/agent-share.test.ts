import { describe, expect, it } from 'vitest'
import { agentsUrl, keyOfAgentsHash, mergeShares, sharedTo } from './agent-share'

describe('agent shares', () => {
  it('are one share whichever machines hold it, with the latest change', () => {
    const shares = mergeShares({
      m1: [
        { id: 's1', name: 'Li', panes: ['w1:p1'], expiresAt: 100 },
        { id: 's2', name: 'Wang', panes: [], expiresAt: 100 },
      ],
      m2: [{ id: 's1', name: 'Li 2', panes: ['w2:p1'], expiresAt: 200 }],
    })
    expect(shares).toEqual([
      { id: 's1', name: 'Li 2', expiresAt: 200, panes: { m1: ['w1:p1'], m2: ['w2:p1'] } },
      { id: 's2', name: 'Wang', expiresAt: 100, panes: { m1: [] } },
    ])
    expect(sharedTo(shares).get('m2/w2:p1')).toEqual(['Li 2'])
  })

  it('link by the key after the #', () => {
    const url = new URL(agentsUrl('https://isbell.fmap.dev', 'isbk1-abc'))
    expect(url.pathname).toBe('/agents')
    expect(keyOfAgentsHash(url.hash)).toBe('isbk1-abc')
    expect(keyOfAgentsHash('#')).toBeUndefined()
    expect(keyOfAgentsHash('')).toBeUndefined()
  })
})
