import { expect, test } from 'vitest'
import { showsSession, worthTelling } from './notices'

const working = { status: 'working', statusSince: 1_000 } as const
const doneAfter = (ms: number) => ({ status: 'done', statusSince: 1_000 + ms }) as const
const MINUTE = 60_000

test('asking is told of; finishing only after a run of ten minutes', () => {
  expect(worthTelling(working, { status: 'blocked', statusSince: 2_000 })).toBe(true)
  expect(worthTelling(undefined, { status: 'blocked', statusSince: 2_000 })).toBe(true)
  expect(worthTelling(working, doneAfter(10 * MINUTE))).toBe(true)
  expect(worthTelling(working, doneAfter(10 * MINUTE - 1))).toBe(false)
  expect(worthTelling({ status: 'idle', statusSince: 0 }, doneAfter(10 * MINUTE))).toBe(false)
  expect(worthTelling(doneAfter(0), doneAfter(10 * MINUTE))).toBe(false)
  expect(worthTelling(undefined, doneAfter(10 * MINUTE))).toBe(false)
})

test('a session is in front of the user in its tab, or peeked at over another', () => {
  expect(showsSession('?tab=session/m/w1%3Ap1', 'm', 'w1:p1')).toBe(true)
  expect(showsSession('?tab=session/m/w2%3Ap1', 'm', 'w1:p1')).toBe(false)
  expect(showsSession('?tab=session/m/w2%3Ap1&peek=m/w1:p1', 'm', 'w1:p1')).toBe(true)
  expect(showsSession('?tab=session/m/w1%3Ap1&peek=m/w2:p1', 'm', 'w1:p1')).toBe(false)
  expect(showsSession('', 'm', 'w1:p1')).toBe(false)
})
