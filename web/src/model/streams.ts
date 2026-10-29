// Calls and streams over one link, matched by id: the relay connection and a direct link each
// have one. A stream is a call whose result opens it; data then flows by the same id until
// either side ends it.

import type { Frame, Header, RpcError } from './frame'

/** Credit window in body bytes, as isbell-proto's flow.rs sets it. */
export const WINDOW = 1 << 20

export class CallError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg)
  }
}

export type DataFrame = { full: boolean; cols?: number; rows?: number; body: Uint8Array }

export type StreamEvents = {
  data: (frame: DataFrame) => void
  /** Once, when the far side ends the stream or the link is lost; not after `close`. */
  end: (error?: RpcError) => void
  /** Bytes the far side lets this side send, on a stream this side writes. */
  credit?: (n: number) => void
}

export type Stream = {
  send: (
    k: 'input' | 'resize' | 'ping' | 'chunk',
    size?: { cols: number; rows: number },
    body?: Uint8Array,
  ) => void
  grant: (n: number) => void
  /** Counts body bytes the consumer has handled; grants them back once they reach WINDOW/2. */
  consumed: (n: number) => void
  /** Ends the stream from this side; on a terminal, the pane stays. */
  close: () => void
  /** Says this side sent all it had, and still hears how the far side ends: a write's outcome. */
  finish: () => void
}

export type Opened = { result: unknown; stream: Stream }

export type Router = {
  call: (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>
  open: (mid: string, m: string, p: unknown, timeoutMs: number, events: StreamEvents) => Promise<Opened>
  /** Hands a res, data or end frame to its call or stream; anything else is ignored. */
  handle: (frame: Frame) => void
  /** Fails the pending calls and ends the open streams whose machine matches. */
  fail: (match: (mid: string) => boolean, code: string, msg: string) => void
}

type Pending = {
  mid: string
  resolve: (r: unknown) => void
  reject: (e: CallError) => void
  timer: ReturnType<typeof setTimeout>
}

type Open = { mid: string; events: StreamEvents }

/** `routed`: frames to the relay name their machine in `mid`; frames on a direct link must not. */
export function createRouter(send: (frame: Frame) => void, routed: boolean): Router {
  const pending = new Map<number, Pending>()
  const streams = new Map<number, Open>()
  let nextId = 1

  const route = (mid: string) => (routed ? { mid } : {})

  const request = (mid: string, m: string, p: unknown, timeoutMs: number, callId: number) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId)
        streams.delete(callId)
        reject(new CallError('timeout', 'the machine did not answer in time'))
      }, timeoutMs)
      pending.set(callId, { mid, resolve, reject, timer })
      send({ header: { t: 'call', id: callId, m, p, ...route(mid) } })
    })

  const streamFor = (id: number, mid: string): Stream => {
    let unacked = 0
    const live = () => streams.has(id)
    const out = (header: Header, body?: Uint8Array) => {
      if (live()) send(body ? { header, body } : { header })
    }
    const grant = (n: number) => out({ t: 'credit', id, n, ...route(mid) })
    return {
      send: (k, size, body) => out({ t: 'data', id, k, ...size, ...route(mid) }, body),
      grant,
      consumed: n => {
        unacked += n
        if (unacked < WINDOW / 2) return
        grant(unacked)
        unacked = 0
      },
      close: () => {
        if (!live()) return
        out({ t: 'end', id, ...route(mid) })
        streams.delete(id)
      },
      finish: () => out({ t: 'end', id, ...route(mid) }),
    }
  }

  const settle = (h: Extract<Header, { t: 'res' }>) => {
    const p = pending.get(h.id)
    if (!p) return
    pending.delete(h.id)
    clearTimeout(p.timer)
    if (h.ok) p.resolve(h.r ?? null)
    else {
      streams.delete(h.id)
      p.reject(new CallError(h.e?.code ?? 'error', h.e?.msg ?? 'the call failed'))
    }
  }

  return {
    call: (mid, m, p, timeoutMs) => request(mid, m, p, timeoutMs, nextId++),
    open: async (mid, m, p, timeoutMs, events) => {
      const callId = nextId++
      // Registered before the call goes out, so data right behind the result is not lost.
      streams.set(callId, { mid, events })
      const result = await request(mid, m, p, timeoutMs, callId)
      return { result, stream: streamFor(callId, mid) }
    },
    handle: ({ header: h, body }) => {
      if (h.t === 'res') settle(h)
      // A terminal's frames carry its screen; a file's chunks are bytes alone.
      else if (h.t === 'data' && (h.k === 'frame' || h.k === 'chunk')) {
        const { full, cols, rows } = h
        const size = cols && rows ? { cols, rows } : {}
        streams.get(h.id)?.events.data({ full: full === true, ...size, body: body ?? new Uint8Array() })
      } else if (h.t === 'credit') streams.get(h.id)?.events.credit?.(h.n)
      else if (h.t === 'end') {
        const s = streams.get(h.id)
        streams.delete(h.id)
        s?.events.end(h.e)
      }
    },
    fail: (match, code, msg) => {
      for (const [id, p] of pending) {
        if (!match(p.mid)) continue
        pending.delete(id)
        streams.delete(id)
        clearTimeout(p.timer)
        p.reject(new CallError(code, msg))
      }
      for (const [id, s] of streams) {
        if (!match(s.mid)) continue
        streams.delete(id)
        s.events.end({ code, msg })
      }
    },
  }
}
