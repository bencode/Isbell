// What the keyboard leaves of the screen. iOS lays the keyboard over the page instead of resizing
// it, and pans the page to keep the focused field in sight; the visual viewport says what shows.

import { useEffect, useState } from 'react'

type Area = { top: number; height: number }

const read = (vv: VisualViewport): Area => ({ top: vv.offsetTop, height: vv.height })

/** The part of the layout viewport that is visible; undefined without `visualViewport`. */
export function useVisibleArea(): Area | undefined {
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
