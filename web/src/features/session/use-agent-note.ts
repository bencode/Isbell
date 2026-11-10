// What herdr knows of an agent besides its screen: read when first wanted, when the session's status
// changes, when the page comes back into view, and, while the agent works, 5s after each read
// returns. What was read under one status is not shown under the next.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import type { AgentNote } from '../../model/agent-note'
import { agentNote } from '../../model/herdr'
import type { Session } from '../../model/projects'

const READ_EVERY_MS = 5_000

type NoteTarget = Pick<Session, 'mid' | 'paneId' | 'status' | 'statusSince'>

export function useAgentNote({ mid, paneId, status, statusSince }: NoteTarget): AgentNote | undefined {
  const { call } = useSpace()
  const [read, setRead] = useState<{ since: number; note: AgentNote }>()

  useEffect(() => {
    // Once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    let next: ReturnType<typeof setTimeout> | undefined
    const fetchNote = () => {
      if (document.visibilityState !== 'visible') return Promise.resolve()
      return agentNote(call, mid, paneId).then(
        note => {
          if (live) setRead({ since: statusSince, note })
        },
        // The note only adds to what is shown: the last one is kept.
        (err: unknown) => console.error(`could not read what herdr knows of ${paneId}`, err),
      )
    }
    const tick = async () => {
      await fetchNote()
      if (live && status === 'working') next = setTimeout(tick, READ_EVERY_MS)
    }
    void tick()
    const shown = () => void fetchNote()
    document.addEventListener('visibilitychange', shown)
    return () => {
      live = false
      clearTimeout(next)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [call, mid, paneId, status, statusSince])

  return read?.since === statusSince ? read.note : undefined
}

/** What a card says under its title: the tool it waits on or is using, or what it was asked; and
 * `topic`, what the turn was asked whatever its status, for a title where its terminal has none. */
export function useCardNote(session: NoteTarget) {
  const note = useAgentNote(session)
  return {
    tool:
      session.status === 'blocked' ? note?.asking : session.status === 'working' ? note?.doing : undefined,
    asked: session.status === 'done' ? note?.asked : undefined,
    topic: note?.asked,
  }
}
