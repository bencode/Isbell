// A terminal on a machine: an `isbell.terminal` stream in control mode. Output is granted back
// as it reaches the screen, so a slow screen slows the machine instead of piling up.

import type { RpcError } from './frame'
import type { Space, Via } from './space'
import { WINDOW } from './streams'

export type TerminalTarget = { target: string } | { new: { cwd: string } }

export type TerminalEvents = {
  /** Call `done` once the bytes are on screen. */
  output: (bytes: Uint8Array, done: () => void) => void
  size: (cols: number, rows: number) => void
  end: (error?: RpcError) => void
}

export type Terminal = {
  via: Via
  /** The new shell's pane; null when attaching. */
  paneId: string | null
  input: (bytes: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  /** Detaches; the pane stays in herdr. */
  close: () => void
}

const OPEN_TIMEOUT_MS = 50_000
/** The gateway ends a terminal that hears nothing for 45s. */
const PING_EVERY_MS = 15_000
/** Every keystroke is a frame, and the relay allows 50 a second; typing is sent in batches. */
const INPUT_BATCH_MS = 30

export async function openTerminal(
  space: Space,
  mid: string,
  target: TerminalTarget,
  size: { cols: number; rows: number },
  events: TerminalEvents,
): Promise<Terminal> {
  let shown = { cols: 0, rows: 0 }
  let sent = size
  let timer: ReturnType<typeof setInterval> | undefined
  let batch: Uint8Array[] = []
  let flush: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    clearInterval(timer)
    clearTimeout(flush)
  }
  const { result, stream, via } = await space.openStream(
    mid,
    'isbell.terminal',
    { ...target, mode: 'control', ...size },
    OPEN_TIMEOUT_MS,
    {
      data: ({ cols, rows, body }) => {
        if (cols && rows && (cols !== shown.cols || rows !== shown.rows)) {
          shown = { cols, rows }
          events.size(cols, rows)
        }
        if (body.length) events.output(body, () => stream.consumed(body.length))
      },
      end: error => {
        stop()
        events.end(error)
      },
    },
  )
  stream.grant(WINDOW)
  timer = setInterval(() => stream.send('ping'), PING_EVERY_MS)

  const send = () => {
    flush = undefined
    const bytes = concat(batch)
    batch = []
    stream.send('input', undefined, bytes)
  }
  return {
    via,
    paneId: (result as { paneId?: string | null } | null)?.paneId ?? null,
    input: bytes => {
      batch.push(bytes)
      if (via !== 'relay') send()
      else flush ??= setTimeout(send, INPUT_BATCH_MS)
    },
    resize: (cols, rows) => {
      if (cols === sent.cols && rows === sent.rows) return
      sent = { cols, rows }
      stream.send('resize', sent)
    },
    close: () => {
      stop()
      if (batch.length) send()
      stream.close()
    },
  }
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
