// One authenticated WebSocket to the relay, as a client. Calls are matched to results by id;
// the connection comes back on its own after a drop, except when the relay rejects the key.

import { decode, encode, type Frame, type Header } from './frame'
import { type Identity, originOf, signAuth } from './identity'

/** Close code the relay uses when the key does not verify. */
const CLOSE_AUTH_FAILED = 4003
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'rejected'

export class CallError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg)
  }
}

export type ConnectionEvents = {
  status: (status: ConnStatus) => void
  snapshot: (machines: { state: unknown; online: boolean }[]) => void
  state: (state: unknown) => void
  presence: (mid: string, online: boolean) => void
}

export type Connection = {
  /** Resolves with the result, or rejects with a CallError. */
  call: (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>
  /** Opens a stream and ends it as soon as it is open; resolves with the open result. */
  openThenEnd: (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>
  /** Fails calls in flight to a machine that went offline or restarted. */
  failMachine: (mid: string) => void
  /** Skips the remaining backoff when the network or the page comes back. */
  reconnectNow: () => void
  close: () => void
}

type Pending = {
  mid: string
  resolve: (r: unknown) => void
  reject: (e: CallError) => void
  timer: ReturnType<typeof setTimeout>
}

export function connect(url: string, id: Identity, on: ConnectionEvents): Connection {
  const origin = originOf(url)
  const pending = new Map<number, Pending>()
  let nextId = 1
  let socket: WebSocket | undefined
  // The relay closes a connection whose first frame is not `auth`, so calls wait for the snapshot.
  let ready = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const send = (frame: Frame) => socket?.send(encode(frame))

  const fail = (match: (p: Pending) => boolean, code: string, msg: string) => {
    for (const [callId, p] of pending) {
      if (!match(p)) continue
      pending.delete(callId)
      clearTimeout(p.timer)
      p.reject(new CallError(code, msg))
    }
  }

  const open = () => {
    retry = undefined
    ready = false
    on.status(attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    ws.onmessage = event => {
      if (socket !== ws) return
      handle(ws, decode(event.data as string | ArrayBuffer).header)
    }
    ws.onclose = event => {
      if (socket !== ws) return
      socket = undefined
      fail(() => true, 'disconnected', 'lost the connection to the relay')
      if (event.code === CLOSE_AUTH_FAILED) {
        on.status('rejected')
        return
      }
      if (closed) return
      on.status('reconnecting')
      retry = setTimeout(open, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)])
      attempt += 1
    }
  }

  const handle = (ws: WebSocket, h: Header) => {
    if (h.t === 'challenge') {
      // Signing for another origin would let that relay replay the signature here.
      if (h.origin !== origin) {
        console.error('relay challenge is for another origin', h.origin, origin)
        ws.close()
        return
      }
      send({
        header: { t: 'auth', role: 'client', pk: id.pk, sig: signAuth(id, 'client', h.origin, h.nonce) },
      })
    } else if (h.t === 'snapshot') {
      attempt = 0
      ready = true
      on.snapshot(h.machines)
      on.status('open')
    } else if (h.t === 'state') {
      on.state(h.state)
    } else if (h.t === 'presence') {
      if (!h.online) fail(p => p.mid === h.mid, 'machine_offline', 'the machine went offline')
      on.presence(h.mid, h.online)
    } else if (h.t === 'res') {
      const p = pending.get(h.id)
      if (!p) return
      pending.delete(h.id)
      clearTimeout(p.timer)
      if (h.ok) p.resolve(h.r ?? null)
      else p.reject(new CallError(h.e?.code ?? 'error', h.e?.msg ?? 'the call failed'))
    }
    // auth_ok needs nothing; data, credit and end belong to streams this client already ended.
  }

  /** Sends a call; `done` settles with its result. */
  const request = (mid: string, m: string, p: unknown, timeoutMs: number) => {
    const callId = nextId++
    const done = new Promise<unknown>((resolve, reject) => {
      if (!ready || socket?.readyState !== WebSocket.OPEN) {
        reject(new CallError('disconnected', 'not connected to the relay'))
        return
      }
      const timer = setTimeout(() => {
        pending.delete(callId)
        reject(new CallError('timeout', 'the machine did not answer in time'))
      }, timeoutMs)
      pending.set(callId, { mid, resolve, reject, timer })
      send({ header: { t: 'call', id: callId, m, p, mid } })
    })
    return { callId, done }
  }

  open()

  return {
    call: (mid, m, p, timeoutMs) => request(mid, m, p, timeoutMs).done,
    openThenEnd: async (mid, m, p, timeoutMs) => {
      const { callId, done } = request(mid, m, p, timeoutMs)
      const r = await done
      send({ header: { t: 'end', id: callId, mid } })
      return r
    },
    failMachine: mid => fail(p => p.mid === mid, 'machine_offline', 'the machine restarted'),
    reconnectNow: () => {
      if (retry === undefined) return
      clearTimeout(retry)
      open()
    },
    close: () => {
      closed = true
      clearTimeout(retry)
      socket?.close()
    },
  }
}
