import { useEffect, useRef } from 'react'

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** The palette's key, ⌘K on a Mac and Ctrl+K elsewhere, from anywhere: a text field or the terminal
 * too. A Mac's Ctrl+K is left alone, as text fields there cut to the end of the line with it. */
export function useCommandKey(press: () => void) {
  const latest = useRef(press)
  latest.current = press
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || e.shiftKey || e.altKey || e.isComposing) return
      if (MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return
      e.preventDefault()
      latest.current()
    }
    // Caught on the way down, before the terminal or an editor can take it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
