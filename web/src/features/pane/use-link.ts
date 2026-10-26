// The direct link behind a terminal, for its facts: read again every few seconds while they show,
// since the browser does not announce changes to a pair's measurements.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import type { LinkStats } from '../../model/direct'
import type { DirectStatus, Via } from '../../model/space'

const EVERY_MS = 2_000

type Link = { direct?: DirectStatus; stats?: LinkStats | undefined }

/** Where machine `mid`'s direct link stands and, on a direct path, its pair; read while mounted. */
export function useLink(mid: string, via: Via | undefined): Link {
  const space = useSpace()
  const [link, setLink] = useState<Link>({})
  useEffect(() => {
    if (!via) return
    let live = true
    const read = async () => {
      const direct = space.directStatus(mid)
      const stats = via !== 'relay' && direct.state === 'open' ? await direct.link.stats() : undefined
      if (live) setLink({ direct, stats })
    }
    // The next read waits for this one, so slow reads never pile up; once the effect is over, the
    // pending one finds `live` false and the chain stops. A failed read keeps the last on screen.
    const tick = async () => {
      if (!live) return
      await read().catch(err => console.warn('could not read the direct link', mid, err))
      if (live) setTimeout(tick, EVERY_MS)
    }
    void tick()
    return () => {
      live = false
    }
  }, [space, mid, via])
  return link
}
