import { expect, test } from 'vitest'
import { FIRST, follow } from './open'

test('before a row is picked, the first one is open', () => {
  expect(follow(['a', 'b'], FIRST)).toEqual({ key: 'a', at: 0 })
})

test('the open row stays open as the rows around it move', () => {
  expect(follow(['new', 'a', 'b'], { key: 'a', at: 0 })).toEqual({ key: 'a', at: 1 })
})

test('once the open row leaves, the row that took its place opens', () => {
  expect(follow(['a', 'c'], { key: 'b', at: 1 })).toEqual({ key: 'c', at: 1 })
  // The last row left: the one before it.
  expect(follow(['a', 'b'], { key: 'c', at: 2 })).toEqual({ key: 'b', at: 1 })
  expect(follow([], { key: 'a', at: 0 })).toBeNull()
  expect(follow(['a'], null)).toBeNull()
})
