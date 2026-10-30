// A scroller's place, kept while an Activity hides it (which takes it to the top) and put back as it
// shows again.

import { type UIEvent, useLayoutEffect, useRef } from 'react'

/** Spread onto the element that scrolls; it must stay the same element while the hook's owner lives. */
export function useKeptScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const top = useRef(0)
  // Layout effects run again each time an Activity shows its content.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = top.current
  }, [])
  return {
    ref,
    onScroll: (e: UIEvent<T>) => {
      top.current = e.currentTarget.scrollTop
    },
  }
}
