// What this client knows of its space, as an external store: each machine's latest state and
// whether it is online (pushed by the relay), and each machine's plain shells (pulled from herdr,
// since machine state only lists agents).

import { type ConnStatus, connect } from './connection'
import { type Caller, shells as fetchShells, type Shell } from './herdr'
import type { Identity } from './identity'
import { isNewer, type MachineState, readState } from './state'

export type MachineEntry = { state: MachineState; online: boolean }

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
      if (old && state.boot > old.state.boot) conn.failMachine(mid)
      machines.set(mid, { state, online: old?.online ?? true })
      changed()
      void refreshOne(mid)
    },
    presence: (mid, online) => {
      const old = machines.get(mid)
      if (!old) return
      machines.set(mid, { ...old, online })
      if (!online) shells.delete(mid)
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
    refreshShells,
    reconnectNow: conn.reconnectNow,
    close: conn.close,
  }
}
