// A session's conversation as its agent records it (see model/chat), shared by the tabs that show
// it: the end of the file first, more before it as asked, and what is added while the agent works.
// Read only while the page shows, one read at a time for each file.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { endOf, splitLines } from '../model/chat/lines'
import { entriesOf, readsRecord, turnsOf } from '../model/chat/turns'
import type { ChatTurn } from '../model/chat/types'
import { isMissing, read } from '../model/files/remote'
import { dirKey } from '../model/projects'
import type { Space } from '../model/space'
import { type AgentStatus, settled } from '../model/state'
import { useSpace } from './space'

/** How much is read at a time: the end of the file, or the part before what is read. */
const PART = 1 << 20
/** What is read first, back from the end, until it holds this many turns or this much. */
const FIRST_TURNS = 3
const FIRST_MAX = 8 << 20
/** A gateway too old to read part of a file reads it whole, up to this. */
const WHOLE_MAX = 4 << 20
const FOLLOW_EVERY_MS = 2_000
const FOLLOW_WHOLE_EVERY_MS = 10_000

type Log = {
  /** The record's lines from `start` to `end`, in bytes of the file. */
  lines: unknown[]
  start: number
  end: number
  /** The cut line before `start`, joined with the part before it once that is read. */
  head?: Uint8Array
  /** The gateway reads files only whole: each read reads all of it again. */
  whole: boolean
  paging: boolean
  error?: unknown
  /** There is no such file (any more), or it is too large for this gateway: the chat is read off the screen. */
  unread: boolean
}

const known = new Map<string, Log>()
/** Each file's reads, one after another. */
const queues = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function put(id: string, log: Log) {
  known.set(id, log)
  for (const listener of listeners) listener()
}

function inTurn(id: string, task: () => Promise<void>) {
  const next = (queues.get(id) ?? Promise.resolve()).then(task).catch((err: unknown) => {
    console.warn('could not read the session record', err)
    const was = known.get(id)
    put(id, was ? { ...was, paging: false, error: err } : { ...UNREAD, error: err })
  })
  queues.set(id, next)
  return next
}

const UNREAD: Log = { lines: [], start: 0, end: 0, whole: false, paging: false, unread: true }

const join = (a: Uint8Array, b: Uint8Array | undefined) => {
  if (!b?.length) return a
  const both = new Uint8Array(a.length + b.length)
  both.set(a)
  both.set(b, a.length)
  return both
}

type Reader = { space: Space; id: string; mid: string; path: string; kind: string }

/** The turns read whole: those whose question is read. */
const turnCount = (kind: string, log: Log) =>
  turnsOf(entriesOf(kind, log.lines)).filter(turn => turn.you).length

/** The part before what is read, its cut line joined to the part read before. */
async function before({ space, mid, path }: Reader, log: Log): Promise<Log> {
  const offset = Math.max(0, log.start - PART)
  const got = await read(space.openStream, mid, path, PART, { offset, want: log.start - offset })
  if (!got.bytes) return log
  const { lines, head } = splitLines(join(got.bytes, log.head), offset === 0)
  const { head: _joined, ...rest } = log
  return { ...rest, lines: [...lines, ...log.lines], start: offset, ...(head ? { head } : {}) }
}

/** The end of the file, and more before it until it holds a few turns. */
async function first(r: Reader) {
  const got = await read(r.space.openStream, r.mid, r.path, WHOLE_MAX, { tail: PART })
  if (!got.bytes) {
    put(r.id, UNREAD)
    return
  }
  const start = got.offset ?? 0
  const { lines, head } = splitLines(got.bytes, start === 0)
  let log: Log = {
    lines,
    start,
    end: endOf(got.bytes, start),
    ...(head ? { head } : {}),
    whole: got.offset === undefined,
    paging: false,
    unread: false,
  }
  while (log.start > 0 && log.end - log.start < FIRST_MAX && turnCount(r.kind, log) < FIRST_TURNS) {
    const was = log.start
    log = await before(r, log)
    if (log.start === was) break
  }
  put(r.id, log)
}

/** What was added since the last read; all of it again when the file was written anew. */
async function follow(r: Reader, log: Log) {
  if (log.whole) return first(r)
  const got = await read(r.space.openStream, r.mid, r.path, FIRST_MAX, { offset: log.end })
  if (got.size < log.end || !got.bytes) return first(r)
  if (!got.bytes.length) return
  const end = endOf(got.bytes, log.end)
  if (end === log.end) return
  const { lines } = splitLines(got.bytes.subarray(0, end - log.end), true)
  put(r.id, { ...log, lines: [...log.lines, ...lines], end, error: undefined })
}

async function refresh(r: Reader) {
  const log = known.get(r.id)
  try {
    await (log && !log.unread ? follow(r, log) : first(r))
    // A read that went through, even with nothing new: an error before it is over.
    const now = known.get(r.id)
    if (now?.error) put(r.id, { ...now, error: undefined })
  } catch (err) {
    if (!isMissing(err)) throw err
    put(r.id, UNREAD)
  }
}

export type ChatLog = {
  /** Undefined until read, or while it cannot be: the chat is then read off the screen. */
  turns?: ChatTurn[]
  /** The session's start is read. */
  start: boolean
  /** How far into the record it is read: it grows as the agent adds to it, not as earlier turns are read. */
  end: number
  earlier: () => void
  paging: boolean
  error?: unknown
}

/** The conversation in the record at `path` of a `kind` of agent, read again while it works. */
export function useChatLog(
  mid: string,
  kind: string | undefined,
  path: string | undefined,
  status: AgentStatus,
): ChatLog {
  const space = useSpace()
  const id = path ? dirKey(mid, path) : ''
  const log = useSyncExternalStore(subscribe, () => known.get(id))
  const reads = path !== undefined && kind !== undefined && readsRecord(kind)

  useEffect(() => {
    if (!reads || !path || !kind) return
    const r = { space, id, mid, path, kind }
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Once settled, read once more a while later, for what the agent writes as it stops.
    let oneMore = settled(status)
    // While the agent works, again a while after each read is over; a file read whole each time,
    // less often.
    const tick = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      void inTurn(id, () => refresh(r)).then(() => {
        if (!live) return
        if (settled(status)) {
          if (!oneMore) return
          oneMore = false
        }
        timer = setTimeout(tick, known.get(id)?.whole ? FOLLOW_WHOLE_EVERY_MS : FOLLOW_EVERY_MS)
      })
    }
    tick()
    document.addEventListener('visibilitychange', tick)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [reads, space, id, mid, path, kind, status])

  // Parsed again only as lines are read, not as a read begins or fails.
  const lines = log && !log.unread ? log.lines : undefined
  const turns = useMemo(
    () => (reads && kind && lines ? turnsOf(entriesOf(kind, lines)) : undefined),
    [reads, kind, lines],
  )
  const earlier = useCallback(() => {
    if (!path || !kind) return
    const r = { space, id, mid, path, kind }
    void inTurn(id, async () => {
      const was = known.get(id)
      if (!was || was.unread || was.start === 0 || was.paging) return
      put(id, { ...was, paging: true })
      put(id, { ...(await before(r, was)), paging: false, error: undefined })
    })
  }, [space, id, mid, path, kind])
  return {
    ...(turns ? { turns } : {}),
    start: log?.start === 0,
    end: log?.end ?? 0,
    earlier,
    paging: log?.paging ?? false,
    ...(log?.error ? { error: log.error } : {}),
  }
}
