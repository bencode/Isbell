// What of the page shows on a phone or a tablet: iOS lays the keyboard over the page instead of
// resizing it, so a terminal keeps to what it leaves by itself.

import { useEffect, useState } from 'react'

/** `keyboard`: the system keyboard is up, under what shows. */
export type VisibleArea = { top: number; height: number; keyboard: boolean }

const read = (vv: VisualViewport): VisibleArea => ({
  top: vv.offsetTop,
  height: vv.height,
  keyboard: vv.offsetTop + vv.height < window.innerHeight - 1,
})

export function useVisibleArea(): VisibleArea | undefined {
  const [area, setArea] = useState(() => (window.visualViewport ? read(window.visualViewport) : undefined))
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setArea(read(vv))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return area
}
