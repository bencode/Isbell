import { expect, test } from 'vitest'
import { barKeyBytes } from './term-keys'

test('arrows follow the cursor-key mode; the other keys do not', () => {
  expect(barKeyBytes('up', false)).toBe('\x1b[A')
  expect(barKeyBytes('down', true)).toBe('\x1bOB')
  expect(barKeyBytes('esc', true)).toBe('\x1b')
  expect(barKeyBytes('enter', false)).toBe('\r')
  expect(barKeyBytes('interrupt', false)).toBe('\x03')
  expect(barKeyBytes('2', false)).toBe('2')
  expect(barKeyBytes('backTab', true)).toBe('\x1b[Z')
  expect(barKeyBytes('pageUp', true)).toBe('\x1b[5~')
  expect(barKeyBytes('pageDown', false)).toBe('\x1b[6~')
})
