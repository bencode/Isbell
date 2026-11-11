import { expect, test } from 'vitest'
import { pinIn } from './held-order'

test('the row opened keeps its part and place; the others go where they now belong', () => {
  // a was first of those finished when opened; seen, it stands by now, and c finished meanwhile.
  const next = [
    { key: 'c', group: 'finished' },
    { key: 'b', group: 'finished' },
    { key: 'a', group: 'idle' },
    { key: 'd', group: 'idle' },
  ]
  expect(pinIn(next, { key: 'a', group: 'finished', index: 0 })).toEqual([
    { key: 'a', group: 'finished' },
    { key: 'c', group: 'finished' },
    { key: 'b', group: 'finished' },
    { key: 'd', group: 'idle' },
  ])
  // Gone, it is not put back.
  expect(pinIn(next.slice(0, 2), { key: 'a', group: 'finished', index: 0 })).toEqual(next.slice(0, 2))
})
