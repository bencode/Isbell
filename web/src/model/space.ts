// What this client knows of its space, as an external store: each machine's latest state and
// whether it is online (pushed by the relay), and each machine's plain shells (pulled from herdr,
// since machine state only lists agents).

import { type ConnStatus, connect } from './connection'
import { type DirectLink, openDirect, type Path } from './direct'
import { type Caller, shells as fetchShells, type Shell } from './herdr'
import type { Identity } from './identity'
import { isNewer, type MachineState, readState } from './state'
import type { Opened, StreamEvents } from './streams'

export type MachineEntry = { state: MachineState; online: boolean }

/** The machine `mid` as the space last heard of it. */
export const machineOf = (machines: MachineEntry[], mid: string) =>
  machines.find(m => m.state.machine.id === mid)

/** How a stream reaches its machine. */
export type Via = 'relay' | Path

/** After a direct link fails, streams to that machine use the relay this long before trying again. */
const DIRECT_RETRY_MS = 5 * 60_000

/** Where this client stands with a machine's direct link. */
export type DirectStatus =
  /** Not tried yet, or the last failure is old enough to try again. */
  | { state: 'none' }
  /** The machine is offline, or its gateway cannot open one. */
  | { state: 'unsupported' }
  | { state: 'opening' }
  | { state: 'open'; link: DirectLink }
  /** `retryInMs` counts from when this status was read. */
  | { state: 'failed'; error: unknown; retryInMs: number }

export type SpaceView = {
  status: ConnStatus
  /** False until the first snapshot arrives. */
  loaded: boolean
  /** Ordered by name, then id. */
  machines: MachineEntry[]
  shells: Shell[]
}

export type Space = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SpaceView
  call: Caller
  openThenEnd: Caller
  /** Opens a stream on machine `mid`, over its direct link when one is open or can be opened. */
  openStream: (
    mid: string,
    m: string,
    p: unknown,
    timeoutMs: number,
    events: StreamEvents,
    transport?: 'auto' | 'relay',
  ) => Promise<Opened & { via: Via }>
  /** Read on demand; it is not part of the view, so it notifies no one. */
  directStatus: (mid: string) => DirectStatus
  /** Pulls the shells of one machine, or of every online machine. */
  refreshShells: (mid?: string) => Promise<void>
  reconnectNow: () => void
  close: () => void
}

export function createSpace(url: string, id: Identity): Space {
  const machines = new Map<string, MachineEntry>()
  const shells = new Map<string, Shell[]>()
  // A newer pull for a machine wins over a slower, older one.
  const pulls = new Map<string, number>()
  const listeners = new Set<() => void>()
  // Per machine: the link being opened or open (undefined once an attempt failed), and the open one.
  const links = new Map<string, Promise<DirectLink | undefined>>()
  const direct = new Map<string, DirectLink>()
  const failures = new Map<string, { at: number; error: unknown }>()
  let status: ConnStatus = 'connecting'
  let loaded = false
  let view = build()

  function build(): SpaceView {
    return {
      status,
      loaded,
      machines: [...machines.values()].sort(
        (a, b) =>
          a.state.machine.name.localeCompare(b.state.machine.name) ||
          a.state.machine.id.localeCompare(b.state.machine.id),
      ),
      shells: [...shells.values()].flat(),
    }
  }

  const changed = () => {
    view = build()
    for (const listener of listeners) listener()
  }

  const pullable = (mid: string) => {
    const m = machines.get(mid)
    return m?.online === true && m.state.herdr.status === 'ready'
  }

  const directable = (mid: string) => {
    const m = machines.get(mid)
    return m?.online === true && m.state.caps.methods.includes('isbell.rtc.offer')
  }

  /** The last failure, while it still keeps streams on the relay. */
  const recentFailure = (mid: string) => {
    const failure = failures.get(mid)
    return failure && Date.now() - failure.at < DIRECT_RETRY_MS ? failure : undefined
  }

  const directTo = (mid: string): Promise<DirectLink | undefined> => {
    const known = links.get(mid)
    if (known) return known
    if (!directable(mid) || recentFailure(mid)) return Promise.resolve(undefined)
    const link = openDirect(conn.call, mid).then(
      opened => {
        direct.set(mid, opened)
        void opened.closed.then(() => {
          direct.delete(mid)
          links.delete(mid)
        })
        return opened
      },
      err => {
        links.delete(mid)
        failures.set(mid, { at: Date.now(), error: err })
        console.warn('no direct link; streams use the relay', mid, err)
        return undefined
      },
    )
    links.set(mid, link)
    return link
  }

  const directStatus = (mid: string): DirectStatus => {
    const open = direct.get(mid)
    if (open) return { state: 'open', link: open }
    if (links.has(mid)) return { state: 'opening' }
    const failure = recentFailure(mid)
    if (failure)
      return { state: 'failed', error: failure.error, retryInMs: failure.at + DIRECT_RETRY_MS - Date.now() }
    return directable(mid) ? { state: 'none' } : { state: 'unsupported' }
  }

  const refreshOne = async (mid: string) => {
    if (!pullable(mid)) return
    const seq = (pulls.get(mid) ?? 0) + 1
    pulls.set(mid, seq)
    try {
      const found = await fetchShells(conn.call, mid)
      if (pulls.get(mid) !== seq) return
      shells.set(mid, found)
      changed()
    } catch (err) {
      console.warn('could not list shells', mid, err)
    }
  }

  const refreshShells = async (mid?: string) => {
    const mids = mid ? [mid] : [...machines.keys()]
    await Promise.all(mids.map(refreshOne))
  }

  const conn = connect(url, id, {
    status: s => {
      status = s
      changed()
    },
    snapshot: entries => {
      machines.clear()
      for (const entry of entries) {
        const state = readState(entry.state)
        if (state) machines.set(state.machine.id, { state, online: entry.online })
      }
      for (const mid of shells.keys()) if (!machines.get(mid)?.online) shells.delete(mid)
      loaded = true
      changed()
      void refreshShells()
    },
    state: value => {
      const state = readState(value)
      if (!state) return
      const mid = state.machine.id
      const old = machines.get(mid)
      if (old && !isNewer(state, old.state)) return
      if (old && state.boot > old.state.boot) {
        conn.failMachine(mid)
        direct.get(mid)?.close()
      }
      machines.set(mid, { state, online: old?.online ?? true })
      changed()
      void refreshOne(mid)
    },
    presence: (mid, online) => {
      const old = machines.get(mid)
      if (!old) return
      machines.set(mid, { ...old, online })
      if (!online) {
        shells.delete(mid)
        direct.get(mid)?.close()
      }
      changed()
      if (online) void refreshOne(mid)
    },
  })

  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => view,
    call: conn.call,
    openThenEnd: conn.openThenEnd,
    openStream: async (mid, m, p, timeoutMs, events, transport = 'auto') => {
      const link = transport === 'auto' ? await directTo(mid) : undefined
      if (link) return { ...(await link.open(m, p, timeoutMs, events)), via: link.path }
      return { ...(await conn.open(mid, m, p, timeoutMs, events)), via: 'relay' }
    },
    directStatus,
    refreshShells,
    reconnectNow: conn.reconnectNow,
    close: () => {
      for (const link of direct.values()) link.close()
      conn.close()
    },
  }
}
