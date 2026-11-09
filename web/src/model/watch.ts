// Watching a shared terminal: a stream the machine fills with the one pane it shares. What the
// viewer can do is decided there; this asks for nothing but to watch.

import type { Space } from './space'
import { WINDOW } from './streams'

export type WatchPhase = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'full'

export type WatchEvents = {
  /** Call `done` once the bytes are on screen. */
  output: (bytes: Uint8Array, done: () => void) => void
  size: (cols: number, rows: number) => void
  end: (code?: string) => void
}

export type Watch = { close: () => void }

const OPEN_TIMEOUT_MS = 30_000
/** The gateway ends a terminal that hears nothing for 45s. */
const PING_EVERY_MS = 15_000

export async function openWatch(space: Space, mid: string, events: WatchEvents): Promise<Watch> {
  let shown = { cols: 0, rows: 0 }
  let timer: ReturnType<typeof setInterval> | undefined
  const { stream } = await space.openStream(mid, 'isbell.terminal', {}, OPEN_TIMEOUT_MS, {
    data: ({ cols, rows, body }) => {
      if (cols && rows && (cols !== shown.cols || rows !== shown.rows)) {
        shown = { cols, rows }
        events.size(cols, rows)
      }
      if (body.length) events.output(body, () => stream.consumed(body.length))
    },
    end: error => {
      clearInterval(timer)
      events.end(error?.code)
    },
  })
  stream.grant(WINDOW)
  timer = setInterval(() => stream.send('ping'), PING_EVERY_MS)
  return {
    close: () => {
      clearInterval(timer)
      stream.close()
    },
  }
}

export type AfterEnd = 'ended' | 'full' | 'reopen' | 'retry'

const AFTER = new Map<string, AfterEnd>([
  ['share_ended', 'ended'],
  ['method_not_allowed', 'ended'],
  ['too_many_streams', 'full'],
  ['resized', 'reopen'],
])

/** What a stream's end, or its failing to open, means for the viewer. */
export const afterEnd = (code: string | undefined): AfterEnd =>
  (code === undefined ? undefined : AFTER.get(code)) ?? 'retry'
