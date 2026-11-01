// One authenticated WebSocket to the relay, as a client. Calls and streams are matched by id;
// the connection comes back on its own after a drop, except when the relay rejects the key.

import { decode, encode, type Frame } from './frame'
import { type Identity, originOf, signAuth } from './identity'
import { CallError, createRouter, type Router } from './streams'

/** Close code the relay uses when the key does not verify. */
const CLOSE_AUTH_FAILED = 4003
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
/** How long a call made while the connection is down waits for it, as when the page comes back
 * from the background and dials again. */
const READY_WAIT_MS = 5_000

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'rejected'

export type ConnectionEvents = {
  status: (status: ConnStatus) => void
  snapshot: (machines: { state: unknown; online: boolean }[]) => void
  state: (state: unknown) => void
  presence: (mid: string, online: boolean) => void
}

export type Connection = {
  /** Resolves with the result, or rejects with a CallError. */
  call: Router['call']
  /** Opens a stream: a call whose result starts it. */
  open: Router['open']
  /** Opens a stream and ends it as soon as it is open; resolves with the open result. */
  openThenEnd: (mid: string, m: string, p: unknown, timeoutMs: number) => Promise<unknown>
  /** Fails calls in flight to a machine that went offline or restarted. */
  failMachine: (mid: string) => void
  /** Skips the remaining backoff when the network or the page comes back. */
  reconnectNow: () => void
  close: () => void
}

export function connect(url: string, id: Identity, on: ConnectionEvents): Connection {
  const origin = originOf(url)
  let socket: WebSocket | undefined
  // The relay closes a connection whose first frame is not `auth`, so calls wait for the snapshot.
  let ready = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  // Closed here, or refused by the relay: it does not dial again, and a call fails at once.
  let closed = false
  // Calls waiting for the connection, let go once the snapshot arrives.
  const waiters = new Set<() => void>()

  const send = (frame: Frame) => socket?.send(encode(frame))
  const router = createRouter(send, true)

  const dial = () => {
    retry = undefined
    ready = false
    on.status(attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    ws.onmessage = event => {
      if (socket !== ws) return
      handle(ws, decode(event.data as string | ArrayBuffer))
    }
    ws.onclose = event => {
      if (socket !== ws) return
      socket = undefined
      router.fail(() => true, 'disconnected', 'lost the connection to the relay')
      if (event.code === CLOSE_AUTH_FAILED) {
        closed = true
        on.status('rejected')
        return
      }
      if (closed) return
      on.status('reconnecting')
      retry = setTimeout(dial, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)])
      attempt += 1
    }
  }

  const handle = (ws: WebSocket, frame: Frame) => {
    const h = frame.header
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
      for (const go of waiters) go()
      waiters.clear()
      on.snapshot(h.machines)
      on.status('open')
    } else if (h.t === 'state') {
      on.state(h.state)
    } else if (h.t === 'presence') {
      if (!h.online) router.fail(mid => mid === h.mid, 'machine_offline', 'the machine went offline')
      on.presence(h.mid, h.online)
    } else {
      router.handle(frame)
    }
    // auth_ok needs nothing; the router ignores what is not for a call or stream.
  }

  const reconnectNow = () => {
    if (retry === undefined) return
    clearTimeout(retry)
    dial()
  }

  const whenConnected = (): Promise<void> => {
    if (ready && socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (closed) return Promise.reject(new CallError('disconnected', 'not connected to the relay'))
    return new Promise((resolve, reject) => {
      const go = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        waiters.delete(go)
        reject(new CallError('disconnected', 'not connected to the relay'))
      }, READY_WAIT_MS)
      waiters.add(go)
      // A retry waiting out its backoff dials now: someone is waiting on it.
      reconnectNow()
    })
  }

  dial()

  return {
    call: async (mid, m, p, timeoutMs) => {
      await whenConnected()
      return router.call(mid, m, p, timeoutMs)
    },
    open: async (mid, m, p, timeoutMs, events) => {
      await whenConnected()
      return router.open(mid, m, p, timeoutMs, events)
    },
    openThenEnd: async (mid, m, p, timeoutMs) => {
      await whenConnected()
      const { result, stream } = await router.open(mid, m, p, timeoutMs, { data: () => {}, end: () => {} })
      stream.close()
      return result
    },
    failMachine: mid => router.fail(m => m === mid, 'machine_offline', 'the machine restarted'),
    reconnectNow,
    close: () => {
      closed = true
      clearTimeout(retry)
      retry = undefined
      socket?.close()
    },
  }
}
