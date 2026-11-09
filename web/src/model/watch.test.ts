import { expect, test } from 'vitest'
import { afterEnd } from './watch'

test('a share that is over stops the viewer, and anything else is tried again', () => {
  expect(afterEnd('share_ended')).toBe('ended')
  expect(afterEnd('too_many_streams')).toBe('full')
  expect(afterEnd('resized')).toBe('reopen')
  expect(afterEnd('machine_offline')).toBe('retry')
  expect(afterEnd(undefined)).toBe('retry')
})
