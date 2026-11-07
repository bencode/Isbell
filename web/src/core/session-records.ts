// The sessions recorded for each project (see model/sessions), shared by its list and its tabs: its
// latest, read when shown, when the page comes back into view and as the machine's state changes; the
// months before, asked for; and which of them run in its panes now. Read only while the page shows.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { isMissing, list, read } from '../model/files/remote'
import { agentNote, type Caller } from '../model/herdr'
import { dirKey, type Project, type Session } from '../model/projects'
import {
  lineTime,
  type MonthLine,
  mergeMonths,
  mergeRecent,
  monthPath,
  monthsDir,
  parseMonth,
  parseRecent,
  type RecordSource,
  recentPath,
  recordSources,
  type SessionLine,
  type SessionRecord,
  sessionKey,
  within,
} from '../model/sessions'
import { machineOf, projectsSettled, type Space } from '../model/space'
import type { AgentStatus } from '../model/state'
import { useSpace, useSpaceView } from './space'
import { useFilesRoots } from './worktrees'

/** Far above what a list of 50 sessions, or a month's, takes. */
const READ_MAX = 4 << 20
/** As many latest as the hook keeps for a project (RECENT_MAX in integrations/agent-hook.sh). */
const RECENT_MAX = 50
const MONTH_FILE = /^(\d{4}-\d{2})\.jsonl$/

type Loaded = {
  /** The latest, the last active first; undefined until first read. */
  recent?: SessionRecord[]
  /** Whether a place kept as many latest as it keeps, so months may hold more. */
  full: boolean
  /** Every month with records, the latest first, once listed; how many are read, and every session
   * they held. */
  months?: string[]
  read: number
  older: MonthLine[]
  /** The panes the project's sessions run in, by `sessionKey`. */
  running: ReadonlyMap<string, string>
  error?: unknown
  /** Why months could not be read: they are asked again by hand, or with the next refresh. */
  monthsError?: unknown
  busy: boolean
}

const EMPTY: Loaded = { full: false, read: 0, older: [], running: new Map(), busy: false }

/** By `dirKey(mid, path)` of the project. */
const known = new Map<string, Loaded>()
/** The session each pane ran, as last read, by `dirKey(mid, paneId)`. */
const panes = new Map<string, { agent: string; id: string }>()
const reading = new Set<string>()
/** Asked to read while a read was out: what to read with once it is over. */
const again = new Map<string, () => void>()
const listeners = new Set<() => void>()

/** Finds a session among those read on machine `mid`. */
export type Lookup = (mid: string, agent: string, id: string) => SessionLine | undefined

const makeLookup = (): Lookup => (mid, agent, id) => {
  const key = sessionKey({ agent, id })
  for (const [at, loaded] of known) {
    if (!at.startsWith(dirKey(mid, ''))) continue
    const found = [...(loaded.recent ?? []), ...loaded.older].find(s => sessionKey(s) === key)
    if (found) return found
  }
  return undefined
}
let lookup = makeLookup()

function update(id: string, f: (was: Loaded) => Loaded) {
  known.set(id, f(known.get(id) ?? EMPTY))
  // A new lookup, so what reads one through useSyncExternalStore draws again.
  lookup = makeLookup()
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `f` of each item, one after another: each read takes one of the few streams a machine allows at
 * a time, which its terminals need too, and a project's records may be in many places. */
async function inTurn<A, B>(items: readonly A[], f: (item: A) => Promise<B>): Promise<B[]> {
  const done: B[] = []
  for (const item of items) done.push(await f(item))
  return done
}

const readText = async (space: Space, mid: string, path: string) => {
  try {
    const found = await read(space.openStream, mid, path, READ_MAX)
    if (!found.bytes) console.warn('a session record is too large to read', path, found.size)
    return found.bytes ? new TextDecoder().decode(found.bytes) : ''
  } catch (err) {
    // A place where no session was recorded yet, or no month began.
    if (isMissing(err)) return ''
    throw err
  }
}

/** The session the agent in the pane runs (see AgentNote.session), noted for the pane; none when it
 * cannot be read. */
async function notePane(call: Caller, mid: string, paneId: string, kind: string) {
  try {
    const id = (await agentNote(call, mid, paneId)).session
    if (id) panes.set(dirKey(mid, paneId), { agent: kind, id })
    return id
  } catch (err) {
    console.warn(`could not read which session runs in ${paneId}`, err)
    return undefined
  }
}

/** The session each agent's pane runs, by `sessionKey`. */
async function readRunning(call: Caller, mid: string, agents: Session[]) {
  const found = await Promise.all(
    agents.map(async ({ paneId, kind }) => {
      const id = kind ? await notePane(call, mid, paneId, kind) : undefined
      return kind && id ? [[sessionKey({ agent: kind, id }), paneId] as const] : []
    }),
  )
  return new Map(found.flat())
}

async function refresh(space: Space, id: string, mid: string, sources: RecordSource[], agents: Session[]) {
  if (document.visibilityState !== 'visible') return
  if (reading.has(id)) {
    again.set(id, () => void refresh(space, id, mid, sources, agents))
    return
  }
  reading.add(id)
  try {
    const [lists, running] = await Promise.all([
      inTurn(sources, async source => ({
        source,
        list: parseRecent(await readText(space, mid, recentPath(source.key))),
      })),
      readRunning(space.call, mid, agents),
    ])
    update(id, was => ({
      ...was,
      recent: mergeRecent(lists.map(({ source, list }) => list.filter(s => within(source, s.cwd)))),
      full: lists.some(({ list }) => list.length >= RECENT_MAX),
      running,
      error: undefined,
      monthsError: undefined,
    }))
  } catch (err) {
    // What was read before stays.
    update(id, was => ({ ...was, error: err }))
  } finally {
    reading.delete(id)
    const next = again.get(id)
    again.delete(id)
    next?.()
  }
}

async function listMonths(space: Space, mid: string, sources: RecordSource[]) {
  const names = await inTurn(sources, async s => {
    try {
      return (await list(space.call, mid, monthsDir(s.key))).entries.flatMap(
        e => MONTH_FILE.exec(e.name)?.[1] ?? [],
      )
    } catch (err) {
      if (isMissing(err)) return []
      throw err
    }
  })
  return [...new Set(names.flat())].sort().reverse()
}

/** Reads months back from the latest not read: until one holds a session the latest leave out, or
 * `all`. Every session a month holds is kept, as the latest change. */
async function readMonths(space: Space, id: string, mid: string, sources: RecordSource[], all: boolean) {
  const was = known.get(id)
  if (!was?.recent || was.busy) return
  update(id, s => ({ ...s, busy: true, monthsError: undefined }))
  try {
    const months = was.months ?? (await listMonths(space, mid, sources))
    const latest = new Set(was.recent.map(sessionKey))
    let { read: done, older } = was
    for (const month of months.slice(was.read)) {
      const lines = await inTurn(sources, async s =>
        parseMonth(await readText(space, mid, monthPath(s.key, month))).filter(line => within(s, line.cwd)),
      )
      const found = mergeMonths(lines, new Set(older.map(sessionKey)))
      older = [...older, ...found]
      done += 1
      if (!all && found.some(line => !latest.has(sessionKey(line)))) break
    }
    update(id, s => ({ ...s, months, read: done, older, busy: false }))
  } catch (err) {
    update(id, s => ({ ...s, busy: false, monthsError: err }))
  }
}

export type SessionRecords = {
  /** Undefined until the latest are first read. */
  recent?: SessionRecord[]
  /** The latest and the months read, each session once, the last active first. */
  history: SessionLine[]
  running: ReadonlyMap<string, string>
  error?: unknown
  /** Whether months before may hold more, and whether they are being read. */
  more: boolean
  busy: boolean
  loadOlder: () => void
  /** Reads every month left, as searching needs. */
  loadAll: () => void
}

/** The sessions recorded for `project`, read from wherever they are kept for it: its directory, below
 * it, its worktrees, and a repository it is a directory of. */
export function useSessionRecords(project: Project | undefined): SessionRecords {
  const space = useSpace()
  const view = useSpaceView()
  const { roots, settled } = useFilesRoots(project)
  const { mid = '', path = '' } = project ?? {}
  const id = dirKey(mid, path)
  const found = useSyncExternalStore(subscribe, () => known.get(id)) ?? EMPTY
  const recorded = view.recorded[mid]
  const sources = useMemo(
    () =>
      recorded && path
        ? recordSources(
            recorded,
            path,
            roots.map(root => root.path),
          )
        : [],
    [recorded, path, roots],
  )
  const state = machineOf(view.machines, mid)?.state
  const agents = project?.sessions
  // Offline, or settled without saying where its records are: none will be read for now.
  const unread = !project?.online || (projectsSettled(view) && !recorded)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the panes follow the machine's state, which is what says to read again.
  useEffect(() => {
    // Until the machine says where its records are, reading would find none.
    if (!project || !settled || !recorded) return
    const load = () => void refresh(space, id, mid, sources, agents ?? [])
    load()
    document.addEventListener('visibilitychange', load)
    return () => document.removeEventListener('visibilitychange', load)
  }, [space, id, mid, sources, settled, recorded, state])

  // A session resumed since its month was read is among the latest now, and shows once.
  const history = useMemo(() => {
    const recent = found.recent ?? []
    const latest = new Set(recent.map(sessionKey))
    const older = found.older.filter(s => !latest.has(sessionKey(s)))
    return [...recent, ...older].sort((a, b) => lineTime(b) - lineTime(a))
  }, [found.recent, found.older])
  // Read before the pane went, a session may still name it.
  const running = useMemo(
    () => new Map([...found.running].filter(([, pane]) => agents?.some(s => s.paneId === pane))),
    [found.running, agents],
  )
  const more = found.full && (found.months === undefined || found.read < found.months.length)
  // Stable while nothing changes, as a search asks for it on each change of its text; a new one once
  // a read is over, so a request made meanwhile is made again.
  // A failure is not asked again by itself.
  const { busy, monthsError } = found
  const loadAll = useCallback(() => {
    if (more && !busy && !monthsError) void readMonths(space, id, mid, sources, true)
  }, [more, busy, monthsError, space, id, mid, sources])
  const loadOlder = useCallback(
    () => void readMonths(space, id, mid, sources, false),
    [space, id, mid, sources],
  )
  const recent = found.recent ?? (unread ? [] : undefined)
  return {
    ...(recent ? { recent } : {}),
    history,
    running,
    error: found.error ?? monthsError,
    more,
    busy,
    loadOlder,
    loadAll,
  }
}

/** Finds a session among those read, again as more are. */
export const useRecordLookup = (): Lookup => useSyncExternalStore(subscribe, () => lookup)

/** Notes which session the agent in the pane runs, read again as its status changes; `kind` none for
 * a shell. */
export function usePaneSession(
  mid: string,
  paneId: string,
  kind: string | undefined,
  status: AgentStatus | undefined,
) {
  const { call } = useSpace()
  useEffect(() => {
    // A shell now: what ran in it before is over.
    if (!kind) panes.delete(dirKey(mid, paneId))
    else if (status !== undefined) void notePane(call, mid, paneId, kind)
  }, [call, mid, paneId, kind, status])
}

/** The session the pane was last seen running. */
export const sessionInPane = (mid: string, paneId: string) => panes.get(dirKey(mid, paneId))
