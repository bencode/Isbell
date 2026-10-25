import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import vectors from '../../../crates/isbell-proto/tests/vectors.json'
import type { ConnectionEvents } from './connection'
import type { DirectLink } from './direct'
import { parseKey } from './identity'
import { createSpace, type Space } from './space'
import { CallError, type Stream } from './streams'

// The relay connection and the direct link are stood in for: the test plays the relay and decides
// whether a direct link opens. A plain function, not vi.fn: a vi.fn whose promise rejects is
// reported as an unhandled rejection even though the space handles it.
const relay = vi.hoisted(() => ({ on: undefined as ConnectionEvents | undefined }))
const direct = vi.hoisted(() => ({
  tries: 0,
  open: (): Promise<DirectLink> => Promise.reject(new Error('no direct link set up')),
}))

const stream: Stream = { send: () => {}, grant: () => {}, consumed: () => {}, close: () => {} }

vi.mock('./connection', () => ({
  connect: (_url: string, _id: unknown, on: ConnectionEvents) => {
    relay.on = on
    return {
      call: async () => ({ snapshot: { panes: [] } }),
      open: async () => ({ result: {}, stream }),
      openThenEnd: async () => ({}),
      failMachine: () => {},
      reconnectNow: () => {},
      close: () => {},
    }
  },
}))
vi.mock('./direct', () => ({
  openDirect: () => {
    direct.tries += 1
    return direct.open()
  },
}))

const MID = '0123456789abcdef'
const RETRY_MS = 5 * 60_000

/** A space whose relay has reported one machine, online and able to open direct links. */
function spaceWithMachine(): Space {
  const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
  relay.on?.snapshot([
    {
      online: true,
      state: {
        machine: { id: MID, name: 'mac-mini', hostname: 'mac-mini.local', os: 'macos', version: '0.1.0' },
        boot: 1,
        rev: 1,
        herdr: { status: 'ready' },
        caps: { methods: ['isbell.terminal', 'isbell.rtc.offer'], agentKinds: [] },
        agents: [],
      },
    },
  ])
  return space
}

const open = (space: Space) =>
  space.openStream(MID, 'isbell.terminal', {}, 1_000, { data: () => {}, end: () => {} })

beforeEach(() => {
  direct.tries = 0
})
afterEach(() => vi.useRealTimers())

test('after a direct link fails, streams use the relay and it is not tried again for five minutes', async () => {
  vi.useFakeTimers()
  direct.open = () => Promise.reject(new CallError('direct_failed', 'no direct link within 5s'))
  const space = spaceWithMachine()

  expect((await open(space)).via).toBe('relay')
  expect(space.directStatus(MID)).toEqual({
    state: 'failed',
    error: expect.any(CallError),
    retryInMs: RETRY_MS,
  })
  await open(space)
  expect(direct.tries).toBe(1)

  vi.advanceTimersByTime(RETRY_MS)
  expect(space.directStatus(MID)).toEqual({ state: 'none' })
  await open(space)
  expect(direct.tries).toBe(2)
})

test('streams take an open direct link, and it closes when the machine goes offline', async () => {
  const link: DirectLink = {
    path: 'lan',
    open: async () => ({ result: {}, stream }),
    stats: async () => undefined,
    close: vi.fn(),
    closed: new Promise(() => {}),
  }
  direct.open = async () => link
  const space = spaceWithMachine()

  expect((await open(space)).via).toBe('lan')
  expect(space.directStatus(MID)).toEqual({ state: 'open', link })
  relay.on?.presence(MID, false)
  expect(link.close).toHaveBeenCalledTimes(1)
})
