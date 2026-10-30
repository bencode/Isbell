import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Caller } from '../model/herdr'
import { endSoon, UNDO_MS, undoEnd } from './ending'

/** A machine that counts the panes it is asked to close. */
function machine() {
  const closed: unknown[] = []
  const call: Caller = async (_mid, method, params) => {
    const asked = params as { method?: string; params?: unknown }
    if (method === 'herdr' && asked.method === 'pane.close') closed.push(asked.params)
    return {}
  }
  return { call, closed }
}

describe('ending an agent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('closes nothing when undone in time', async () => {
    const { call, closed } = machine()
    endSoon(call, 'm', 'w1:p1')
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1)
    undoEnd('m', 'w1:p1')
    await vi.advanceTimersByTimeAsync(UNDO_MS * 2)
    expect(closed).toHaveLength(0)
  })

  it('closes the pane once when left', async () => {
    const { call, closed } = machine()
    endSoon(call, 'm', 'w1:p2')
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    expect(closed).toHaveLength(1)
  })
})
