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
const relay = vi.hoisted(() => ({ on: undefined as ConnectionEvents | undefined, calls: [] as string[] }))
const direct = vi.hoisted(() => ({
  tries: 0,
  open: (): Promise<DirectLink> => Promise.reject(new Error('no direct link set up')),
}))

const stream: Stream = { send: () => {}, grant: () => {}, consumed: () => {}, close: () => {} }

vi.mock('./connection', () => ({
  connect: (_url: string, _id: unknown, on: ConnectionEvents) => {
    relay.on = on
    return {
      call: async (_mid: string, m: string) => {
        relay.calls.push(m)
        return { snapshot: { panes: [] } }
      },
      open: async () => ({ result: {}, stream }),
      openThenEnd: async () => ({}),
      failMachine: () => {},
      reconnectNow: () => {},
      close: () => {},
    }
  },
}))
vi.mock('./direct', async importOriginal => ({
  ...(await importOriginal<typeof import('./direct')>()),
  openDirect: () => {
    direct.tries += 1
    return direct.open()
  },
}))

const MID = '0123456789abcdef'
const RETRY_MS = 5 * 60_000
const WAIT_MS = 4_000

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
  relay.calls = []
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

const lanLink = (calls: string[] = [], pieces = true): DirectLink => ({
  path: 'lan',
  pieces,
  open: async () => ({ result: {}, stream }),
  call: async m => {
    calls.push(m)
    return {}
  },
  stats: async () => undefined,
  close: vi.fn(),
  closed: new Promise(() => {}),
})

test('a stream takes the relay while a slow direct link opens, and the streams after it take the link', async () => {
  vi.useFakeTimers()
  const link = lanLink()
  let opened: (link: DirectLink) => void = () => {}
  direct.open = () => new Promise(resolve => (opened = resolve))
  const space = spaceWithMachine()

  const first = open(space)
  await vi.advanceTimersByTimeAsync(WAIT_MS)
  expect((await first).via).toBe('relay')
  expect(space.directStatus(MID)).toEqual({ state: 'opening' })

  opened(link)
  expect((await open(space)).via).toBe('lan')
  expect(direct.tries).toBe(1)
})

test('streams take an open direct link, and it closes when the machine goes offline', async () => {
  const link = lanLink()
  direct.open = async () => link
  const space = spaceWithMachine()

  expect((await open(space)).via).toBe('lan')
  expect(space.directStatus(MID)).toEqual({ state: 'open', link })
  relay.on?.presence(MID, false)
  expect(link.close).toHaveBeenCalledTimes(1)
})

const readVisible = { method: 'agent.read', params: { target: 'p1', source: 'visible' } }

test('a call takes the relay and starts a direct link, and the calls after it take the link', async () => {
  const sent: string[] = []
  direct.open = async () => lanLink(sent)
  const space = spaceWithMachine()
  // Counted from here: the snapshot pulled the machine's shells.
  relay.calls = []

  await space.call(MID, 'herdr', readVisible, 1_000)
  expect([relay.calls, sent]).toEqual([['herdr'], []])
  await vi.waitFor(() => expect(space.directStatus(MID).state).toBe('open'))

  await space.call(MID, 'herdr', readVisible, 1_000)
  expect([relay.calls, sent]).toEqual([['herdr'], ['herdr']])
  expect(direct.tries).toBe(1)
})

test('a link to a gateway without pieces takes streams but no calls', async () => {
  const sent: string[] = []
  direct.open = async () => lanLink(sent, false)
  const space = spaceWithMachine()

  expect((await open(space)).via).toBe('lan')
  relay.calls = []
  await space.call(MID, 'herdr', readVisible, 1_000)
  await space.call(MID, 'isbell.agent.history', { target: 'p1', skip: 0, count: 200 }, 1_000)
  expect([relay.calls, sent]).toEqual([['herdr', 'isbell.agent.history'], []])
  expect(direct.tries).toBe(1)
})
