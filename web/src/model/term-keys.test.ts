import { expect, test } from 'vitest'
import { barKeyBytes, withCtrl } from './term-keys'

test('Ctrl turns a letter into its control byte and leaves the rest as typed', () => {
  expect(withCtrl('c')).toBe('\x03')
  expect(withCtrl('C')).toBe('\x03')
  expect(withCtrl('[')).toBe('\x1b')
  expect(withCtrl(' ')).toBe('\x00')
  expect(withCtrl('1')).toBe('1')
  expect(withCtrl('ok')).toBe('ok')
})

test('arrows follow the cursor-key mode; the other keys do not', () => {
  expect(barKeyBytes('up', false)).toBe('\x1b[A')
  expect(barKeyBytes('left', true)).toBe('\x1bOD')
  expect(barKeyBytes('esc', true)).toBe('\x1b')
  expect(barKeyBytes('enter', false)).toBe('\r')
})
