import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import vectors from '../../../crates/isbell-proto/tests/vectors.json'
import type { ConnectionEvents } from './connection'
import type { DirectLink } from './direct'
import type { RpcError } from './frame'
import { parseKey } from './identity'
import { parseProjects, projectsPath, serializeProjects } from './project-config'
import { createSpace, projectsSettled, type Space } from './space'
import { CallError, type Stream, type StreamEvents } from './streams'

// The relay connection and the direct link are stood in for: the test plays the relay and decides
// whether a direct link opens. A plain function, not vi.fn: a vi.fn whose promise rejects is
// reported as an unhandled rejection even though the space handles it.
const relay = vi.hoisted(() => ({
  on: undefined as ConnectionEvents | undefined,
  calls: [] as string[],
  /** Answers the calls in place of the default, when a test sets it. */
  answer: undefined as ((m: string, p: unknown) => Promise<unknown>) | undefined,
  /** Plays the machine's end of a stream, when a test sets it. */
  stream: undefined as ((m: string, p: unknown, events: StreamEvents) => void) | undefined,
  /** Hears what is sent on a stream, and that all of it was. */
  sent: undefined as ((body: Uint8Array) => void) | undefined,
  finished: undefined as (() => void) | undefined,
}))
const direct = vi.hoisted(() => ({
  tries: 0,
  open: (): Promise<DirectLink> => Promise.reject(new Error('no direct link set up')),
}))

const stream: Stream = {
  send: (_k, _size, body) => {
    if (body) relay.sent?.(body)
  },
  grant: () => {},
  consumed: () => {},
  close: () => {},
  finish: () => relay.finished?.(),
}

vi.mock('./connection', () => ({
  connect: (_url: string, _id: unknown, on: ConnectionEvents) => {
    relay.on = on
    return {
      call: async (_mid: string, m: string, p: unknown) => {
        relay.calls.push(m)
        return relay.answer ? relay.answer(m, p) : { snapshot: { panes: [] } }
      },
      open: async (_mid: string, m: string, p: unknown, _ms: number, events: StreamEvents) => {
        relay.stream?.(m, p, events)
        return { result: {}, stream }
      },
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

const machineState = (boot: number) => ({
  machine: { id: MID, name: 'mac-mini', hostname: 'mac-mini.local', os: 'macos', version: '0.1.0' },
  boot,
  rev: 1,
  herdr: { status: 'ready' },
  caps: { methods: ['isbell.terminal', 'isbell.rtc.offer'], agentKinds: [] },
  agents: [],
})

/** A space whose relay has reported one machine, online and able to open direct links. */
function spaceWithMachine(): Space {
  const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
  relay.on?.snapshot([{ online: true, state: machineState(1) }])
  return space
}

const open = (space: Space) =>
  space.openStream(MID, 'isbell.terminal', {}, 1_000, { data: () => {}, end: () => {} })

beforeEach(() => {
  direct.tries = 0
  relay.calls = []
  relay.answer = undefined
  relay.stream = undefined
  relay.sent = undefined
  relay.finished = undefined
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

test('a machine that restarts has its shells pulled over the relay, not over the link it closed', async () => {
  const sent: string[] = []
  const link = lanLink(sent)
  direct.open = async () => link
  const space = spaceWithMachine()

  expect((await open(space)).via).toBe('lan')
  relay.calls = []
  relay.on?.state(machineState(2))
  expect(link.close).toHaveBeenCalledTimes(1)
  expect([relay.calls, sent]).toEqual([['herdr'], []])
  expect(space.callVia(MID)).toBe('relay')
})

test('the projects settle only once the first shells are pulled and the repositories looked up', async () => {
  let pullShells = () => {}
  const shellsPulled = new Promise<unknown>(resolve => {
    pullShells = () => resolve({ snapshot: { panes: [] } })
  })
  let listGit = () => {}
  const gitListed = new Promise<void>(resolve => {
    listGit = resolve
  })
  relay.answer = async (m, p) => {
    if (m === 'herdr') return shellsPulled
    await gitListed
    // Only /r is a repository.
    if ((p as { path: string }).path === '/r/.git') return { entries: [], total: 0, truncated: false }
    throw new CallError('not_found', 'no such directory')
  }
  const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
  const agent = { paneId: 'w1:p1', status: 'working', statusSince: 0, cwd: '/r/web' }
  const state = {
    ...machineState(1),
    caps: { methods: ['isbell.file.list'], agentKinds: [] },
    agents: [agent],
  }
  relay.on?.snapshot([{ online: true, state }])
  const view = () => space.getSnapshot()
  // Seen loaded, it already knows what it is still finding out.
  expect([view().loaded, view().pulling, [...view().looking]]).toEqual([true, true, [`${MID}:/r/web`]])

  pullShells()
  await vi.waitFor(() => expect(view().pulling).toBe(false))
  expect([...view().looking, projectsSettled(view())]).toEqual([`${MID}:/r/web`, false])

  listGit()
  await vi.waitFor(() => expect(projectsSettled(view())).toBe(true))
  expect(view().repos).toEqual({ [`${MID}:/r/web`]: '/r' })
})

const shellsKnown = (space: Space) => space.getSnapshot().shellsKnown.has(MID)

test('the shells of a machine count as known only once they have come since it came online', async () => {
  direct.open = () => Promise.reject(new CallError('direct_failed', 'no direct link'))
  const space = spaceWithMachine()
  expect(shellsKnown(space)).toBe(false)
  await vi.waitFor(() => expect(shellsKnown(space)).toBe(true))

  relay.on?.presence(MID, false)
  expect(shellsKnown(space)).toBe(false)

  relay.answer = () => Promise.reject(new CallError('unavailable', 'herdr went away'))
  relay.on?.presence(MID, true)
  await vi.waitFor(() => expect(relay.calls.length).toBeGreaterThan(1))
  await new Promise(resolve => setTimeout(resolve))
  expect(shellsKnown(space)).toBe(false)
})

test('a herdr that gets ready later is pulled before its shells count as known', async () => {
  const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
  const waiting = { ...machineState(1), herdr: { status: 'unavailable' } }
  relay.on?.snapshot([{ online: true, state: waiting }])
  await new Promise(resolve => setTimeout(resolve))
  expect(shellsKnown(space)).toBe(false)

  relay.on?.state({ ...machineState(1), rev: 2 })
  expect(shellsKnown(space)).toBe(false)
  await vi.waitFor(() => expect(shellsKnown(space)).toBe(true))
})

describe('changing the projects a machine lists', () => {
  const methods = ['isbell.file.read', 'isbell.file.write']
  const state = { ...machineState(1), caps: { methods, agentKinds: [] } }

  /** A machine whose list holds `file.text`, or that has none, and that keeps what is written to it,
   * or refuses it with `refusal`. */
  function machineWithFile(text: string | undefined, refusal?: RpcError) {
    const file = { text, written: [] as string[] }
    relay.sent = body => file.written.push(new TextDecoder().decode(body))
    relay.stream = (m, p, events) => {
      if (m === 'isbell.file.write') {
        if (refusal) return events.end(refusal)
        relay.finished = () => events.end()
        return events.credit?.(1 << 20)
      }
      if ((p as { path: string }).path !== projectsPath || file.text === undefined)
        return events.end({ code: 'not_found', msg: 'no such file' })
      const body = new TextEncoder().encode(file.text)
      setTimeout(() => {
        events.data({ full: false, body })
        events.end()
      })
    }
    const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
    relay.on?.snapshot([{ online: true, state }])
    return { space, file }
  }

  const add = (path: string) => (paths: string[] | undefined) => [...(paths ?? []), path]
  const config = (space: Space) => space.getSnapshot().configs[MID]

  test('starts from what the file says now, not from what was read before', async () => {
    const { space, file } = machineWithFile(undefined)
    await vi.waitFor(() => expect(config(space)).toEqual({ state: 'missing' }))

    file.text = serializeProjects(['/w/edited'])
    await space.changeProjects(MID, add('/w/new'))

    expect(file.written.map(parseProjects)).toEqual([['/w/edited', '/w/new']])
  })

  test('never writes over a file that cannot be read', async () => {
    const { space, file } = machineWithFile(serializeProjects(['/w/a']))
    await vi.waitFor(() => expect(config(space)?.state).toBe('listed'))

    file.text = '{'
    await expect(space.changeProjects(MID, add('/w/new'))).rejects.toThrow(CallError)

    expect(file.written).toEqual([])
    expect(config(space)).toEqual({ state: 'broken' })
  })

  test('a list started while a file came to be is left to that file', async () => {
    const { space, file } = machineWithFile(undefined)
    await vi.waitFor(() => expect(config(space)).toEqual({ state: 'missing' }))

    file.text = serializeProjects([])
    await space.changeProjects(MID, listed => (listed ? undefined : ['/w/a']))

    expect(file.written).toEqual([])
    expect(config(space)).toEqual({ state: 'listed', paths: [] })
  })

  test.each<[string, () => void]>([
    ['the browser reconnects', () => relay.on?.snapshot([{ online: true, state }])],
    [
      'the machine comes back online',
      () => {
        relay.on?.presence(MID, false)
        relay.on?.presence(MID, true)
      },
    ],
  ])('a list that could not be started says so, until %s', async (_, reconnect) => {
    const { space } = machineWithFile(undefined, { code: 'not_found', msg: 'no such directory' })
    await expect(space.changeProjects(MID, add('/w/new'))).rejects.toThrow(CallError)
    expect(config(space)).toEqual({ state: 'unwritable' })

    reconnect()
    await vi.waitFor(() => expect(config(space)).toEqual({ state: 'missing' }))
  })

  test.each(['not_a_file', 'permission_denied'])('a file refused with %s cannot be read', async code => {
    relay.stream = (_m, _p, events) => events.end({ code, msg: 'refused' })
    const space = createSpace('wss://relay.test/v1/ws', parseKey(vectors.identity.key))
    relay.on?.snapshot([{ online: true, state }])
    await vi.waitFor(() => expect(config(space)).toEqual({ state: 'broken' }))
  })
})
