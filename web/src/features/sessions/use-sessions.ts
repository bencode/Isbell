// The sessions recorded in a project, as its machine keeps them (see model/sessions): its latest,
// read when shown, when the page comes back into view, and as the machine's state changes, a turn
// that ends changing both; which of them run in its panes now; and, asked for, the months before.

import { useEffect, useState } from 'react'
import { useSpace, useSpaceView } from '../../core/space'
import { list, read } from '../../model/files/remote'
import { agentNote } from '../../model/herdr'
import type { Project } from '../../model/projects'
import {
  type MonthLine,
  monthPath,
  monthsDir,
  parseMonth,
  parseRecent,
  recentPath,
  type SessionRecord,
} from '../../model/sessions'
import { machineOf } from '../../model/space'
import { CallError } from '../../model/streams'

/** Far above what a list of 50 sessions, or a month's, takes. */
const READ_MAX = 4 << 20
/** As many latest as the hook keeps for a project (RECENT_MAX in integrations/agent-hook.sh). */
const RECENT_MAX = 50
const MONTH_FILE = /^(\d{4}-\d{2})\.jsonl$/

export type Month = { month: string; lines: MonthLine[] }

export type Sessions = {
  /** The latest, the last active first; undefined until first read. */
  recent: SessionRecord[] | undefined
  error?: unknown
  /** The panes the project's sessions run in, by session id. */
  running: ReadonlyMap<string, string>
  /** The months before, the latest first, each with the sessions begun in it that `recent` leaves
   * out. */
  older: Month[]
  /** Whether there may be months before those read, and whether they are being read. */
  more: boolean
  busy: boolean
  loadOlder: () => void
}

const isNotFound = (err: unknown) => err instanceof CallError && err.code === 'not_found'

export function useSessions(project: Project): Sessions {
  const space = useSpace()
  const view = useSpaceView()
  const { mid } = project
  // Where its machine keeps its records: none when no session was recorded in it.
  const key = view.recorded[mid]?.[project.path]?.key
  const state = machineOf(view.machines, mid)?.state
  const panes = project.sessions.map(s => s.paneId)
  const [recent, setRecent] = useState<SessionRecord[]>()
  const [error, setError] = useState<unknown>()
  const [running, setRunning] = useState<ReadonlyMap<string, string>>(new Map())
  // Every month with records, the latest first, once listed; and those read so far.
  const [months, setMonths] = useState<string[]>()
  const [older, setOlder] = useState<Month[]>([])
  const [busy, setBusy] = useState(false)

  const readText = async (path: string) => {
    const found = await read(space.openStream, mid, path, READ_MAX)
    return found.bytes ? new TextDecoder().decode(found.bytes) : ''
  }

  /** The session running in `pane`, as its agent's hook reported it; none from a pane gone since. */
  const sessionIn = async (pane: string) => {
    try {
      return (await agentNote(space.call, mid, pane)).session
    } catch (err) {
      console.warn(`could not read which session runs in ${pane}`, err)
      return undefined
    }
  }

  /** The project's latest, as written; none before the first one is recorded. */
  const readRecent = async (at: string) => {
    try {
      return await readText(recentPath(at))
    } catch (err) {
      if (isNotFound(err)) return ''
      throw err
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the panes follow the machine's state, which is what says to read again.
  useEffect(() => {
    // Once the effect is over, a late answer is dropped.
    let live = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const [text, notes] = await Promise.all([
          key ? readRecent(key) : '',
          Promise.all(panes.map(async pane => ({ pane, session: await sessionIn(pane) }))),
        ])
        if (!live) return
        setRecent(text ? parseRecent(text) : [])
        setRunning(new Map(notes.flatMap(({ pane, session }) => (session ? [[session, pane]] : []))))
        setError(undefined)
      } catch (err) {
        // What was read before stays.
        if (live) setError(err)
      }
    }
    void load()
    const shown = () => void load()
    document.addEventListener('visibilitychange', shown)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', shown)
    }
  }, [space, mid, key, state])

  /** Reads months back from the latest not read, until one holds a session `recent` leaves out. */
  const loadOlder = () => {
    if (!key || busy) return
    setBusy(true)
    const seen = new Set(recent?.map(s => s.id))
    const listMonths = async (): Promise<string[]> => {
      try {
        const { entries } = await list(space.call, mid, monthsDir(key))
        return entries
          .flatMap(e => MONTH_FILE.exec(e.name)?.[1] ?? [])
          .sort()
          .reverse()
      } catch (err) {
        if (isNotFound(err)) return []
        throw err
      }
    }
    const go = async () => {
      const all = months ?? (await listMonths())
      setMonths(all)
      const found: Month[] = []
      for (const month of all.slice(older.length)) {
        const lines = parseMonth(await readText(monthPath(key, month))).filter(s => !seen.has(s.id))
        found.push({ month, lines })
        if (lines.length) break
      }
      setOlder(was => [...was, ...found])
    }
    go().then(
      () => setBusy(false),
      err => {
        setBusy(false)
        setError(err)
      },
    )
  }

  return {
    recent,
    error,
    running,
    older,
    // The hook keeps up to RECENT_MAX latest: fewer, and none is left out of them.
    more:
      !!key && (recent?.length ?? 0) >= RECENT_MAX && (months === undefined || older.length < months.length),
    busy,
    loadOlder,
  }
}
