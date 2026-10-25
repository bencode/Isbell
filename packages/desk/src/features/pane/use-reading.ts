// An agent pane's screen, read as turns. It is read when the page opens, when the session's
// status changes (the relay pushes it), when the page comes back into view, and on demand after
// something was sent; while the agent works it is read again 2s after each read returns. Earlier
// turns come on request, a page of history at a time.

import {
  type History,
  mergeReading,
  parseScreen,
  type Reading,
  readHistory,
  readScreen,
  type Session,
  settled,
  stitch,
} from '@isbell/core'
import { useEffect, useRef, useState } from 'react'
import { useSpace } from '../../core/space'

const READ_EVERY_MS = 2_000
// A page of history, read with an overlap into what is known, so the two still meet when a few
// lines came or went at the bottom in between.
const PAGE = 200
const OVERLAP = 40
// The pages one request reads at most while they bring no turn that was not there.
const MAX_PAGES = 5

type Screen = {
  /** Null until a read is recognised as turns; the page then shows `text` as it is. */
  reading: Reading | null
  text: string | null
  error: unknown
  /** The history known, down to the last whole read; null before one. */
  lines: string[] | null
  /** Whether earlier history may remain. */
  more: boolean
}

const UNREAD: Screen = { reading: null, text: null, error: undefined, lines: null, more: true }

const linesOf = (text: string) => text.replace(/\n$/, '').split('\n')

/** The last lines with scrollback, joined to the history known when the two meet. */
function readWhole(s: Screen, kind: string | undefined, text: string): Screen {
  const fresh = linesOf(text)
  const joined = s.lines && stitch(s.lines, fresh)
  const lines = joined ?? fresh
  const reading = parseScreen(kind, lines.join('\n'), false) ?? s.reading
  return { reading, text, error: undefined, lines, more: joined ? s.more : true }
}

/** The screen alone, folded into what was read before. */
function readVisible(s: Screen, kind: string | undefined, text: string): Screen {
  const next = parseScreen(kind, text, true)
  return { ...s, reading: next ? mergeReading(s.reading, next, false) : s.reading, text, error: undefined }
}

/** A page further back, joined to the history known; null when the two do not meet. */
function readPage(s: Screen, kind: string | undefined, page: History): Screen | null {
  const lines = s.lines && stitch(linesOf(page.text), s.lines)
  if (!lines) return null
  const reading = parseScreen(kind, lines.join('\n'), false) ?? s.reading
  return { ...s, reading, error: undefined, lines, more: page.more }
}

export function useReading(
  mid: string,
  paneId: string,
  session: Pick<Session, 'kind' | 'status' | 'statusSince'>,
) {
  const space = useSpace()
  // The ref holds the screen as of the last read, for reads that follow at once; the state
  // mirrors it for rendering.
  const known = useRef(UNREAD)
  const [screen, setScreen] = useState(UNREAD)
  const update = (f: (s: Screen) => Screen) => {
    known.current = f(known.current)
    setScreen(known.current)
  }
  const [paging, setPaging] = useState(false)
  // Bumped to read at once.
  const [round, setRound] = useState(0)
  // Reads wait for each other: herdr cuts a history read short while another runs, and a page
  // must meet the history as the reads before it left it.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const { kind, status, statusSince } = session

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `statusSince` or `round` is a reason to read again; `update` only touches refs and state.
  useEffect(() => {
    // herdr has a full-screen agent's scrollback only while it is idle or done; otherwise the
    // screen alone is read, and folded into what was read before.
    const whole = settled(status)
    const poll = status === 'working' || status === 'unknown'
    // Once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    const read = () => {
      queue.current = queue.current.then(() => {
        if (!live || document.visibilityState !== 'visible') return
        return readScreen(space.call, mid, paneId, whole ? 'recent' : 'visible').then(
          text => {
            if (live) update(s => (whole ? readWhole(s, kind, text) : readVisible(s, kind, text)))
          },
          error => {
            if (live) update(s => ({ ...s, error }))
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

  /** Reads pages further back until one brings an earlier turn or the start of the session. */
  const earlier = () => {
    setPaging(true)
    const turns = () => known.current.reading?.turns.length ?? 0
    const before = turns()
    queue.current = queue.current
      .then(async () => {
        for (let n = 0; n < MAX_PAGES; n += 1) {
          const { lines, more, reading } = known.current
          if (!lines || !more || reading?.start || turns() > before) return
          const skip = Math.max(0, lines.length - OVERLAP)
          const page = await readHistory(space.call, mid, paneId, skip, PAGE + OVERLAP)
          const next = readPage(known.current, kind, page)
          // The history moved on more than the overlap covers: start again from its end.
          if (!next) {
            setRound(r => r + 1)
            return
          }
          update(() => next)
        }
      })
      .catch(error => update(s => ({ ...s, error })))
      .finally(() => setPaging(false))
  }

  const { reading, text, error, more } = screen
  return { reading, text, error, more, paging, earlier, reread: () => setRound(n => n + 1) }
}
