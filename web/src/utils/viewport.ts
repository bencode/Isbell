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

/** The keyboard, while it is up; zeros while it is down, or without `visualViewport`. */
export type Keyboard = {
  /** How tall it is: steady while it is up, so room left for it does not change as the page
   * scrolls, which would scroll the page again. */
  height: number
  /** How far a bar fixed to the bottom of the layout viewport rises to sit on it, with however far
   * iOS has panned what shows: for a transform only, which moves nothing else. */
  lift: number
}

const DOWN: Keyboard = { height: 0, lift: 0 }

export function useKeyboard(): Keyboard {
  const [keyboard, setKeyboard] = useState(DOWN)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let frame = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      frame = 0
      const height = Math.max(0, Math.round(window.innerHeight - vv.height))
      const lift = Math.max(0, Math.round(height - vv.offsetTop))
      // The same object while nothing changed, so a pan that moves nothing renders nothing.
      setKeyboard(k => (k.height === height && k.lift === lift ? k : { height, lift }))
    }
    // Once a frame, however many events come in it.
    const update = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    // iOS can leave the viewport's offset where it was once the keyboard is down: look again after.
    const left = () => {
      clearTimeout(settle)
      settle = setTimeout(update, 300)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    document.addEventListener('focusout', left)
    update()
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.removeEventListener('focusout', left)
    }
  }, [])
  return keyboard
}

/** While mounted, the document neither scrolls nor bounces, so a scroller on the page has the
 * gestures to itself. */
export function useLockedPage() {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.scroll = 'locked'
    return () => {
      delete root.dataset.scroll
    }
  }, [])
}
