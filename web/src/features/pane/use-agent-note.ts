// What herdr knows of an agent besides its screen: read when the card opens, when the session's
// status changes, when the page comes back into view, and, while the agent works, 2s after each
// read returns; not while its machine is offline.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import type { AgentNote } from '../../model/agent-note'
import { agentNote } from '../../model/herdr'
import type { Session } from '../../model/projects'

const READ_EVERY_MS = 2_000

export function useAgentNote(
  session: Pick<Session, 'mid' | 'paneId' | 'status' | 'statusSince'>,
  online = true,
): AgentNote | undefined {
  const space = useSpace()
  const [note, setNote] = useState<AgentNote>()
  const { mid, paneId, status, statusSince } = session

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `statusSince` is a reason to read again.
  useEffect(() => {
    if (!online) return
    // Once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    let next: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      if (document.visibilityState !== 'visible') return Promise.resolve()
      return agentNote(space.call, mid, paneId).then(
        found => {
          if (live) setNote(found)
        },
        // The note only adds to the screen, which the card still shows: the last one is kept.
        (err: unknown) => console.error(`could not read what herdr knows of ${paneId}`, err),
      )
    }
    const tick = async () => {
      await read()
      if (live && status === 'working') next = setTimeout(tick, READ_EVERY_MS)
    }
    void tick()
    const shown = () => void read()
    document.addEventListener('visibilitychange', shown)
    return () => {
      live = false
      clearTimeout(next)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [space, mid, paneId, status, statusSince, online])

  return note
}
