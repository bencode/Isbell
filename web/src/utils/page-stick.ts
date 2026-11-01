// A page that scrolls with the window and grows at its end, as a chat does: it stays at the end
// while the reader is there, and lets go once they scroll up. Safari does not anchor the page when
// lines come in above what is read, so loading earlier ones keeps the distance from the end itself.

import { useEffect, useRef } from 'react'

/** How near the end still counts as at it. */
const NEAR_PX = 64

const fromEnd = () => document.documentElement.scrollHeight - window.innerHeight - window.scrollY

/** Starts at the end. `keepFromEnd`, called before what comes in above: the page keeps its distance
 * from the end as it grows, until the reader moves it. */
export function usePageStick(): { keepFromEnd: () => void } {
  const kept = useRef<number | undefined>(undefined)
  useEffect(() => {
    let pinned = true
    let touching = false
    const grown = new ResizeObserver(() => {
      const end = document.documentElement.scrollHeight - window.innerHeight
      if (kept.current !== undefined) window.scrollTo(0, end - kept.current)
      // Not under a finger, which would have the page jump from under it.
      else if (pinned && !touching) window.scrollTo(0, end)
    })
    const scrolled = () => {
      if (kept.current === undefined) pinned = fromEnd() <= NEAR_PX
    }
    const down = () => {
      touching = true
      kept.current = undefined
    }
    const up = () => {
      touching = false
    }
    const wheel = () => {
      kept.current = undefined
    }
    const passive = { passive: true }
    grown.observe(document.body)
    window.addEventListener('scroll', scrolled, passive)
    window.addEventListener('touchstart', down, passive)
    window.addEventListener('touchend', up, passive)
    window.addEventListener('touchcancel', up, passive)
    window.addEventListener('wheel', wheel, passive)
    return () => {
      grown.disconnect()
      window.removeEventListener('scroll', scrolled)
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
      window.removeEventListener('wheel', wheel)
    }
  }, [])
  return {
    keepFromEnd: () => {
      kept.current = fromEnd()
    },
  }
}
