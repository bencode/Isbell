// A machine's spec and load, read from its gateway when asked for and 2s after each read returns,
// skipping reads while the page is hidden; not while `able` is false.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import { readSystem, type System } from '../../model/system'

const READ_EVERY_MS = 2_000

export function useSystem(mid: string, able: boolean): System | undefined {
  const space = useSpace()
  const [sys, setSys] = useState<System>()

  useEffect(() => {
    if (!able) return
    // Once the effect is over, its chain stops and a late answer is dropped.
    let live = true
    let next: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      if (document.visibilityState !== 'visible') return Promise.resolve()
      return readSystem(space.call, mid).then(
        found => {
          if (live) setSys(found)
        },
        // The last reading stays on screen.
        (err: unknown) => console.error(`could not read the system of ${mid}`, err),
      )
    }
    const tick = async () => {
      await read()
      if (live) next = setTimeout(tick, READ_EVERY_MS)
    }
    void tick()
    return () => {
      live = false
      clearTimeout(next)
    }
  }, [space, mid, able])

  return able ? sys : undefined
}
