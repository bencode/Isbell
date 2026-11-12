// Upgrading a machine from here: the gateway runs the install script, which restarts it with the new
// isbell. A restart ends the call unanswered, so the machine coming back is what says it is done.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import type { MachineEntry } from '../../model/space'
import { CallError } from '../../model/streams'
import { UPGRADE_METHOD } from '../../model/upgrade'

/** How long a machine has to come back upgraded. */
const WAIT_MS = 180_000

export type Upgrade =
  | { phase: 'idle' }
  | { phase: 'upgrading'; boot: number; since: number }
  | { phase: 'done'; version: string }
  | { phase: 'failed'; why: 'failed' | 'notRestarted' | 'timeout'; log?: string }

export function useUpgrade(entry: MachineEntry) {
  const space = useSpace()
  const [upgrade, setUpgrade] = useState<Upgrade>({ phase: 'idle' })
  const mid = entry.state.machine.id
  const { boot } = entry.state
  const { version } = entry.state.machine

  useEffect(() => {
    if (upgrade.phase === 'upgrading' && entry.online && boot > upgrade.boot)
      setUpgrade({ phase: 'done', version })
  }, [upgrade, entry.online, boot, version])

  useEffect(() => {
    if (upgrade.phase !== 'upgrading') return
    const timer = setTimeout(
      () => setUpgrade(now => (now === upgrade ? { phase: 'failed', why: 'timeout' } : now)),
      upgrade.since + WAIT_MS - Date.now(),
    )
    return () => clearTimeout(timer)
  }, [upgrade])

  const start = () => {
    if (upgrade.phase === 'upgrading') return
    const at: Upgrade = { phase: 'upgrading', boot, since: Date.now() }
    setUpgrade(at)
    // What comes after the machine is back, or the wait ran out, changes nothing.
    const settle = (next: Upgrade) => setUpgrade(now => (now === at ? next : now))
    space.call(mid, UPGRADE_METHOD, {}, WAIT_MS).then(
      reply => {
        const log = typeof reply === 'object' && reply !== null && 'log' in reply ? reply.log : undefined
        settle({ phase: 'failed', why: 'notRestarted', ...(typeof log === 'string' && log ? { log } : {}) })
      },
      (err: unknown) => {
        if (err instanceof CallError && err.code === 'upgrade_failed')
          return settle({ phase: 'failed', why: 'failed', log: err.message })
        // The restart ends the call: the machine coming back says how it went.
        console.warn('the upgrade call ended unanswered', mid, err)
      },
    )
  }

  /** Back to what the machine shows, once what happened is seen. */
  const clear = () => setUpgrade(now => (now.phase === 'upgrading' ? now : { phase: 'idle' }))

  return { upgrade, start, clear }
}
