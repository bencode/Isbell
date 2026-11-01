import { expect, test } from 'vitest'
import { behind } from './upgrade'

test('a machine is behind only when its version is older, part by part', () => {
  expect(behind('0.2.0', '0.3.0')).toBe(true)
  expect(behind('0.9.0', '0.10.0')).toBe(true)
  expect(behind('0.3.0', '0.3.0')).toBe(false)
  expect(behind('0.3.1', '0.3.0')).toBe(false)
  expect(behind('0', '0.3.0')).toBe(false)
})
