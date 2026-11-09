import { expect, test } from 'vitest'
import { cellAt, turnWheel, wheelReport } from './term-wheel'

test('small deltas add up to whole lines, and what is short of one carries over', () => {
  const pixels = (deltaY: number) => ({ deltaY, deltaMode: 0 })
  const first = turnWheel(0, pixels(-10), 17, 40)
  expect(wheelReport(first.notches, 1, 1)).toBe('')
  expect(first.left).toBe(-10)
  expect(turnWheel(first.left, pixels(-10), 17, 40)).toEqual({ notches: -1, left: -3 })
  expect(turnWheel(0, { deltaY: 3, deltaMode: 1 }, 17, 40).notches).toBe(3)
  expect(turnWheel(0, { deltaY: 1, deltaMode: 2 }, 17, 40).notches).toBe(40)
})

test('a report per notch, in the direction turned, at the cell under the pointer', () => {
  expect(wheelReport(-2, 3, 4)).toBe('\x1b[<64;3;4M\x1b[<64;3;4M')
  expect(wheelReport(1, 3, 4)).toBe('\x1b[<65;3;4M')
  expect(wheelReport(0, 3, 4)).toBe('')
  const box = { left: 10, top: 20, width: 800, height: 400 }
  expect(cellAt({ x: 10, y: 20 }, box, { cols: 80, rows: 20 })).toEqual({ col: 1, row: 1 })
  expect(cellAt({ x: 810, y: 420 }, box, { cols: 80, rows: 20 })).toEqual({ col: 80, row: 20 })
  expect(cellAt({ x: 415, y: 221 }, box, { cols: 80, rows: 20 })).toEqual({ col: 41, row: 11 })
})
