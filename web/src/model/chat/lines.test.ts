import { expect, test } from 'vitest'
import { endOf, splitLines } from './lines'

const bytes = (s: string) => new TextEncoder().encode(s)

test('a part read from the middle keeps its cut first line, to be joined with the part before it', () => {
  const file = '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4'
  const later = splitLines(bytes(file.slice(12)), false)
  // The line still being written is left out, and the cut one kept.
  expect(later.lines).toEqual([{ n: 3 }])
  const head = new TextDecoder().decode(later.head)
  expect(head).toBe(':2}\n')
  const before = splitLines(bytes(`${file.slice(0, 12)}${head}`), true)
  expect(before).toEqual({ lines: [{ n: 1 }, { n: 2 }] })
  expect(endOf(bytes(file), 0)).toBe(24)
})

test('a part with no line end in it is all the front of a line', () => {
  expect(splitLines(bytes('abc'), false).lines).toEqual([])
  expect(splitLines(bytes('abc'), false).head).toEqual(bytes('abc'))
})
