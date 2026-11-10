import { expect, test } from 'vitest'
import { heldOrder } from './held-order'

test('rows keep their place and group while held; one gone leaves, one new comes last', () => {
  const held = [
    { key: 'a', group: 'finished' },
    { key: 'b', group: 'finished' },
    { key: 'c', group: 'idle' },
  ]
  // a was looked at and stands by now, c went away, d came.
  const next = [
    { key: 'b', group: 'finished' },
    { key: 'a', group: 'idle' },
    { key: 'd', group: 'finished' },
  ]
  expect(heldOrder(held, next)).toEqual([
    { key: 'a', group: 'finished' },
    { key: 'b', group: 'finished' },
    { key: 'd', group: 'finished' },
  ])
})
