// The loops of each machine, read once and shared by the views that show them; read again when one
// is opened, as the gateway moves on by itself, and kept in step with what is written from here.

import { useEffect, useSyncExternalStore } from 'react'
import { read, writeText } from '../model/files/remote'
import {
  type Loop,
  type LoopRuns,
  loopRunsPath,
  loopsPath,
  parseLoopRuns,
  parseLoops,
  serializeLoops,
} from '../model/loops'
import { machineOf, type Space } from '../model/space'
import { CallError } from '../model/streams'
import { useSpace, useSpaceView } from './space'

type Open = Space['openStream']
type Known = { loops: Loop[]; runs: LoopRuns }
export type LoopsView = Known & { able: boolean }

const WRITE_METHOD = 'isbell.file.write'
const FILE_MAX = 1 << 20
const NONE: Known = { loops: [], runs: {} }

const known = new Map<string, Known>()
const asked = new Set<string>()
const listeners = new Set<() => void>()

function settle(mid: string, found: Known) {
  known.set(mid, found)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The file's text; undefined when there is none yet, as before the first loop. */
async function readText(open: Open, mid: string, path: string): Promise<string | undefined> {
  try {
    const found = await read(open, mid, path, FILE_MAX)
    if (!found.bytes) throw new CallError('too_large', path)
    return new TextDecoder().decode(found.bytes)
  } catch (err) {
    if (err instanceof CallError && err.code === 'not_found') return undefined
    throw err
  }
}

export async function refreshLoops(open: Open, mid: string): Promise<void> {
  const [loops, runs] = await Promise.all([readText(open, mid, loopsPath), readText(open, mid, loopRunsPath)])
  const listed = loops === undefined ? [] : parseLoops(loops)
  if (!listed) console.warn('the loops listed cannot be read', mid)
  settle(mid, { loops: listed ?? [], runs: runs === undefined ? {} : parseLoopRuns(runs) })
}

/** Applies `change` to the file as it stands now; one that cannot be read is never written over. */
export async function changeLoops(open: Open, mid: string, change: (loops: Loop[]) => Loop[]): Promise<void> {
  const text = await readText(open, mid, loopsPath)
  const loops = text === undefined ? [] : parseLoops(text)
  if (!loops) throw new CallError('loops_broken', loopsPath)
  const next = change(loops)
  await writeText(open, mid, loopsPath, serializeLoops(next))
  settle(mid, { ...(known.get(mid) ?? NONE), loops: next })
}

/** What machine `mid` has; `able` while it is there to take a change. */
export function useLoops(mid: string): LoopsView {
  const { openStream } = useSpace()
  const machine = machineOf(useSpaceView().machines, mid)
  const able = !!machine?.online && machine.state.caps.methods.includes(WRITE_METHOD)
  const found = useSyncExternalStore(subscribe, () => known.get(mid) ?? NONE)
  useEffect(() => {
    if (!able || asked.has(mid)) return
    asked.add(mid)
    refreshLoops(openStream, mid).catch((err: unknown) => {
      asked.delete(mid)
      console.error('could not read the loops', mid, err)
    })
  }, [able, openStream, mid])
  return { ...found, able }
}
