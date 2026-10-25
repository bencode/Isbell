// An agent pane's screen, read as turns. It is read when the page opens, when the session's
// status changes (the relay pushes it), when the page comes back into view, and on demand after
// something was sent; while the agent works it is read again 2s after each read returns.

import { mergeReading, parseScreen, type Reading, readScreen, type Session } from '@isbell/core'
import { useEffect, useRef, useState } from 'react'
import { useSpace } from '../../core/space'

const READ_EVERY_MS = 2_000

type Screen = {
  /** Null until a read is recognised as turns; the page then shows `text` as it is. */
  reading: Reading | null
  text: string | null
  error: unknown
}

export function useReading(
  mid: string,
  paneId: string,
  session: Pick<Session, 'kind' | 'status' | 'statusSince'>,
) {
  const space = useSpace()
  const [screen, setScreen] = useState<Screen>({ reading: null, text: null, error: undefined })
  // Bumped to read at once.
  const [round, setRound] = useState(0)
  // Two history reads of one pane at once come back cut short from herdr, so each read waits for
  // the one before it, the last effect's included.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const { kind, status, statusSince } = session

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `statusSince` or `round` is a reason to read again.
  useEffect(() => {
    // herdr has a full-screen agent's scrollback only while it is idle or done; otherwise the
    // screen alone is read, and folded into what was read before.
    const whole = status === 'idle' || status === 'done'
    const poll = status === 'working' || status === 'unknown'
    // Once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    const read = () => {
      queue.current = queue.current.then(() => {
        if (!live || document.visibilityState !== 'visible') return
        return readScreen(space.call, mid, paneId, whole ? 'recent' : 'visible').then(
          text => {
            if (!live) return
            const next = parseScreen(kind, text, !whole)
            setScreen(s => ({
              reading: next ? mergeReading(s.reading, next, whole) : s.reading,
              text,
              error: undefined,
            }))
          },
          error => {
            if (live) setScreen(s => ({ ...s, error }))
          },
        )
      })
      return queue.current
    }
    const tick = async () => {
      await read()
      if (live && poll) setTimeout(tick, READ_EVERY_MS)
    }
    void tick()
    const shown = () => void read()
    document.addEventListener('visibilitychange', shown)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', shown)
    }
  }, [space, mid, paneId, kind, status, statusSince, round])

  return { ...screen, reread: () => setRound(n => n + 1) }
}
