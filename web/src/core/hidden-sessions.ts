// The sessions each machine's lists leave out (see model/hidden-sessions), read once and shared by
// the lists that show its projects, and kept in step with what is changed from here.

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { read, writeText } from '../model/files/remote'
import { hiddenPath, parseHidden, serializeHidden } from '../model/hidden-sessions'
import { machineOf } from '../model/space'
import { CallError } from '../model/streams'
import { useSpace, useSpaceView } from './space'

type Open = ReturnType<typeof useSpace>['openStream']

const WRITE_METHOD = 'isbell.file.write'
const FILE_MAX = 1 << 20
const NONE: ReadonlySet<string> = new Set()

const known = new Map<string, ReadonlySet<string>>()
const asked = new Set<string>()
const listeners = new Set<() => void>()

function settle(mid: string, hidden: readonly string[]) {
  known.set(mid, new Set(hidden))
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The keys the machine's file lists; none while there is no file, as before the first is hidden. */
async function readHidden(open: Open, mid: string): Promise<string[]> {
  try {
    const found = await read(open, mid, hiddenPath, FILE_MAX)
    if (!found.bytes) throw new CallError('too_large', hiddenPath)
    const hidden = parseHidden(new TextDecoder().decode(found.bytes))
    if (!hidden) throw new CallError('hidden_broken', hiddenPath)
    return hidden
  } catch (err) {
    if (err instanceof CallError && err.code === 'not_found') return []
    throw err
  }
}

/** Hides the session, or shows it again, in the file as it stands now. */
async function changeHidden(open: Open, mid: string, key: string, hide: boolean) {
  const hidden = (await readHidden(open, mid)).filter(k => k !== key)
  const next = hide ? [...hidden, key] : hidden
  await writeText(open, mid, hiddenPath, serializeHidden(next))
  settle(mid, next)
}

export type HiddenSessions = {
  hidden: ReadonlySet<string>
  /** The machine is there to take a change. */
  able: boolean
  setHidden: (key: string, hide: boolean) => Promise<void>
}

/** The sessions machine `mid` hides, by `sessionKey`. */
export function useHiddenSessions(mid: string): HiddenSessions {
  const { openStream } = useSpace()
  const machine = machineOf(useSpaceView().machines, mid)
  const able = !!machine?.online && machine.state.caps.methods.includes(WRITE_METHOD)
  const hidden = useSyncExternalStore(subscribe, () => known.get(mid) ?? NONE)
  useEffect(() => {
    if (!able || asked.has(mid)) return
    asked.add(mid)
    readHidden(openStream, mid).then(
      found => settle(mid, found),
      (err: unknown) => {
        asked.delete(mid)
        console.error('could not read the hidden sessions', mid, err)
      },
    )
  }, [able, openStream, mid])
  const setHidden = useCallback(
    (key: string, hide: boolean) => changeHidden(openStream, mid, key, hide),
    [openStream, mid],
  )
  return { hidden, able, setHidden }
}
