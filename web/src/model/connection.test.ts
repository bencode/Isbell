import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import vectors from '../../../crates/isbell-proto/tests/vectors.json'
import { connect } from './connection'
import { decode, encode, type Header } from './frame'
import { parseKey } from './identity'
import { CallError } from './streams'

const URL = 'wss://relay.test/v1/ws'

/** Stands in for the browser WebSocket: records what is sent, lets the test play the relay. */
class FakeSocket {
  static last: FakeSocket
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  sent: Header[] = []
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  send(data: string | Uint8Array) {
    this.sent.push(decode(data).header)
  }
  close() {}
  open() {
    this.readyState = FakeSocket.OPEN
  }
  receive(header: Header) {
    this.onmessage?.({ data: encode({ header }) as string })
  }
}

beforeEach(() => vi.stubGlobal('WebSocket', FakeSocket))
afterEach(() => vi.unstubAllGlobals())

const silent = { status: () => {}, snapshot: () => {}, state: () => {}, presence: () => {} }

test('a call made before the connection is authenticated waits for it', async () => {
  const conn = connect(URL, parseKey(vectors.identity.key), silent)
  const ws = FakeSocket.last
  ws.open()
  // Open but not yet authenticated: the relay would close on any first frame but `auth`.
  const result = conn.call('m1', 'herdr', {}, 1000)
  ws.receive({ t: 'challenge', nonce: 'n', origin: 'wss://relay.test' })
  ws.receive({ t: 'auth_ok', sid: 's', conn: 'c' })
  expect(ws.sent.map(h => h.t)).toEqual(['auth'])

  ws.receive({ t: 'snapshot', machines: [] })
  await vi.waitFor(() => expect(ws.sent.map(h => h.t)).toEqual(['auth', 'call']))
  ws.receive({ t: 'res', id: 1, ok: true, r: 'done' })
  await expect(result).resolves.toBe('done')
  conn.close()
})

test('a call gives up when the connection does not come back in time', async () => {
  vi.useFakeTimers()
  try {
    const conn = connect(URL, parseKey(vectors.identity.key), silent)
    const result = conn.call('m1', 'herdr', {}, 1000)
    const failed = expect(result).rejects.toEqual(new CallError('disconnected', 'not connected to the relay'))
    await vi.advanceTimersByTimeAsync(5_000)
    await failed
    expect(FakeSocket.last.sent).toEqual([])
    conn.close()
  } finally {
    vi.useRealTimers()
  }
})

test('a call on a closed connection fails at once and dials nothing, even mid-backoff', async () => {
  const conn = connect(URL, parseKey(vectors.identity.key), silent)
  const ws = FakeSocket.last
  // Dropped: a retry waits out its backoff.
  ws.onclose?.({ code: 1006 })
  conn.close()
  await expect(conn.call('m1', 'herdr', {}, 1000)).rejects.toEqual(
    new CallError('disconnected', 'not connected to the relay'),
  )
  expect(FakeSocket.last).toBe(ws)
})
