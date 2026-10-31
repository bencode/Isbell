// What this client knows of its space, as an external store: each machine's latest state and
// whether it is online (pushed by the relay), each machine's plain shells (pulled from herdr,
// since machine state only lists agents), and the projects its recorded sessions ran in (read from
// the machine's files).

import { type ConnStatus, connect } from './connection'
import { type DirectLink, openDirect, type Path } from './direct'
import { read } from './files/remote'
import { repoRootOf } from './files/repo'
import { type Caller, shells as fetchShells, type Shell } from './herdr'
import type { Identity } from './identity'
import { dirKey, type Repos } from './projects'
import { parseRoots, type Roots, rootsPath } from './sessions'
import { isNewer, type MachineState, readState } from './state'
import { CallError, type Opened, type StreamEvents } from './streams'

export type MachineEntry = { state: MachineState; online: boolean }

/** The machine `mid` as the space last heard of it. */
export const machineOf = (machines: MachineEntry[], mid: string) =>
  machines.find(m => m.state.machine.id === mid)

/** How a stream reaches its machine. */
export type Via = 'relay' | Path

/** After a direct link fails, streams and calls to that machine use the relay this long before trying
 * again. */
const DIRECT_RETRY_MS = 5 * 60_000
/** How long a stream waits for a direct link being set up before it takes the relay; the link
 * keeps opening, for the streams after it. */
const DIRECT_WAIT_MS = 4_000
/** Far above what years of projects take. */
const ROOTS_MAX = 1 << 20

/** `link`, or undefined once `ms` pass first. */
const within = <T>(link: Promise<T | undefined>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  return Promise.race([link, late]).finally(() => clearTimeout(timer))
}

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
  repos: Repos
  /** Directories, by `dirKey(mid, cwd)`, whose repository is still being looked up; until it is
   * found, each stands as a project of its own. */
  looking: ReadonlySet<string>
  /** Where each machine's recorded sessions ran, by machine id. */
  recorded: Readonly<Record<string, Roots>>
  /** Whether some machine's shells, or where its sessions ran, are still being pulled for the
   * first time since the snapshot. */
  pulling: boolean
}

/** Whether the projects are as they will stay: a project or pane not among them now is gone, not
 * still to come. */
export const projectsSettled = (view: SpaceView) => view.loaded && !view.pulling && !view.looking.size

export type Space = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SpaceView
  /** Calls machine `mid` over its direct link when one is open and takes pieces, else over the relay. */
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
  /** Where a call to machine `mid` goes now; read on demand, like `directStatus`. */
  callVia: (mid: string) => Via
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
  // The repositories found for the directories reported, and the directories asked about, so each
  // is asked once.
  const repos = new Map<string, string>()
  const asked = new Set<string>()
  const looking = new Set<string>()
  // The machines whose first shells, after a snapshot, have not come yet.
  const pulling = new Set<string>()
  // Where each machine's recorded sessions ran; the machines read now, and those to read once more
  // after, as states can come faster than reads; the machines whose first read, after a snapshot,
  // has not come yet.
  const recorded = new Map<string, Roots>()
  const reads = new Set<string>()
  const again = new Set<string>()
  const reading = new Set<string>()
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
      repos: Object.fromEntries(repos),
      looking: new Set(looking),
      recorded: Object.fromEntries(recorded),
      pulling: pulling.size > 0 || reading.size > 0,
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

  /** The last failure, while it still keeps streams and calls on the relay. */
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
        console.warn('no direct link; streams and calls use the relay', mid, err)
        return undefined
      },
    )
    links.set(mid, link)
    return link
  }

  /** The link calls to `mid` take: an open one that takes pieces, since without them an answer
   * too long for one message would end it. */
  const callLink = (mid: string) => {
    const link = direct.get(mid)
    return link?.pieces ? link : undefined
  }

  const call: Caller = (mid, m, p, timeoutMs) => {
    const link = callLink(mid)
    if (link) return link.call(m, p, timeoutMs)
    // Not waited for, unlike a stream: it serves the calls after this one.
    void directTo(mid)
    return conn.call(mid, m, p, timeoutMs)
  }

  const openStream: Space['openStream'] = async (mid, m, p, timeoutMs, events, transport = 'auto') => {
    const link = transport === 'auto' ? await within(directTo(mid), DIRECT_WAIT_MS) : undefined
    if (link) return { ...(await link.open(m, p, timeoutMs, events)), via: link.path }
    return { ...(await conn.open(mid, m, p, timeoutMs, events)), via: 'relay' }
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

  /** Asks machine `mid` which repository each directory it reports is in, once for each. */
  const findRepos = (mid: string) => {
    const m = machines.get(mid)
    if (!m?.online || !m.state.caps.methods.includes('isbell.file.list')) return
    const cwds = [...m.state.agents.map(a => a.cwd), ...(shells.get(mid) ?? []).map(s => s.cwd)]
    for (const cwd of new Set(cwds.filter((cwd): cwd is string => Boolean(cwd)))) {
      const key = dirKey(mid, cwd)
      if (asked.has(key)) continue
      asked.add(key)
      looking.add(key)
      repoRootOf(call, mid, cwd).then(
        root => {
          if (root) repos.set(key, root)
          looking.delete(key)
          changed()
        },
        (err: unknown) => {
          // Asked again on the next report; until then it stands as its own project.
          asked.delete(key)
          looking.delete(key)
          changed()
          console.warn('could not find the repository of', cwd, err)
        },
      )
    }
  }

  const refreshOne = async (mid: string) => {
    if (!pullable(mid)) return
    const seq = (pulls.get(mid) ?? 0) + 1
    pulls.set(mid, seq)
    try {
      const found = await fetchShells(call, mid)
      if (pulls.get(mid) !== seq) return
      shells.set(mid, found)
      // Its shells' directories are being looked up before it stops counting as pulling.
      findRepos(mid)
      pulling.delete(mid)
      changed()
    } catch (err) {
      pulling.delete(mid)
      changed()
      console.warn('could not list shells', mid, err)
    }
  }

  const readable = (mid: string) => {
    const m = machines.get(mid)
    return m?.online === true && m.state.caps.methods.includes('isbell.file.read')
  }

  /** Reads where machine `mid`'s recorded sessions ran: none where its hook never recorded one,
   * or its gateway takes no path under `~`. Asked while a read is out, it reads once more after. */
  const refreshRecords = async (mid: string) => {
    if (!readable(mid)) return
    if (reads.has(mid)) {
      again.add(mid)
      return
    }
    reads.add(mid)
    try {
      const found = await read(openStream, mid, rootsPath, ROOTS_MAX)
      if (found.bytes) recorded.set(mid, parseRoots(new TextDecoder().decode(found.bytes)))
      else console.warn('the sessions recorded are too many to list', mid, found.size)
    } catch (err) {
      if (err instanceof CallError && (err.code === 'not_found' || err.code === 'bad_request'))
        recorded.set(mid, {})
      // The last read stands, so the projects stay as they were.
      else console.warn('could not read where the sessions recorded ran', mid, err)
    }
    reads.delete(mid)
    reading.delete(mid)
    changed()
    if (again.delete(mid)) void refreshRecords(mid)
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
      // What is still to be found out is known before anyone sees the space loaded.
      for (const mid of machines.keys()) {
        if (pullable(mid)) pulling.add(mid)
        if (readable(mid)) reading.add(mid)
        findRepos(mid)
      }
      changed()
      void refreshShells()
      for (const mid of machines.keys()) void refreshRecords(mid)
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
        // Its `closed` drops it only later, and the pull below must not go to the closed link.
        direct.delete(mid)
      }
      machines.set(mid, { state, online: old?.online ?? true })
      findRepos(mid)
      changed()
      void refreshOne(mid)
      // A session's turn that ends changes the state, and what it recorded.
      void refreshRecords(mid)
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
      if (online) {
        void refreshOne(mid)
        void refreshRecords(mid)
      }
    },
  })

  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => view,
    call,
    callVia: mid => callLink(mid)?.path ?? 'relay',
    openThenEnd: conn.openThenEnd,
    openStream,
    directStatus,
    refreshShells,
    reconnectNow: conn.reconnectNow,
    close: () => {
      for (const link of direct.values()) link.close()
      conn.close()
    },
  }
}
