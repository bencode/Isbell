// The direct link behind a terminal's stream or a page's calls, for its facts: read again every few
// seconds while they show, since neither the space nor the browser announces changes to it.

import { useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import type { LinkStats } from '../../model/direct'
import type { DirectStatus, Via } from '../../model/space'

const EVERY_MS = 2_000

type Link = { via?: Via; direct?: DirectStatus; stats?: LinkStats | undefined }

/**
 * Where machine `mid`'s direct link stands and, on a direct path, its pair; read while mounted.
 * `via` is the path a stream took, or `calls` for the path calls take, which changes as links come
 * and go.
 */
export function useLink(mid: string, via: Via | 'calls' | undefined): Link {
  const space = useSpace()
  const [link, setLink] = useState<Link>({})
  useEffect(() => {
    if (!via) return
    let live = true
    const read = async () => {
      const at = via === 'calls' ? space.callVia(mid) : via
      const direct = space.directStatus(mid)
      const stats = at !== 'relay' && direct.state === 'open' ? await direct.link.stats() : undefined
      if (live) setLink({ via: at, direct, stats })
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
