import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import vectors from '../../../crates/isbell-proto/tests/vectors.json'
import { connect } from '../src/connection'
import { decode, encode, type Header } from '../src/frame'
import { parseKey } from '../src/identity'
import { CallError } from '../src/streams'

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

test('no call reaches the relay before the connection is authenticated', async () => {
  const conn = connect(URL, parseKey(vectors.identity.key), silent)
  const ws = FakeSocket.last
  ws.open()
  // Open but not yet authenticated: the relay would close on any first frame but `auth`.
  await expect(conn.call('m1', 'herdr', {}, 1000)).rejects.toEqual(
    new CallError('disconnected', 'not connected to the relay'),
  )
  ws.receive({ t: 'challenge', nonce: 'n', origin: 'wss://relay.test' })
  expect(ws.sent.map(h => h.t)).toEqual(['auth'])

  ws.receive({ t: 'auth_ok', sid: 's', conn: 'c' })
  ws.receive({ t: 'snapshot', machines: [] })
  const result = conn.call('m1', 'herdr', {}, 1000)
  expect(ws.sent.map(h => h.t)).toEqual(['auth', 'call'])
  ws.receive({ t: 'res', id: 1, ok: true, r: 'done' })
  await expect(result).resolves.toBe('done')
  conn.close()
})
