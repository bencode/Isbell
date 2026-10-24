import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react'

/** Single-key shortcuts by `KeyboardEvent.key` (Escape as `esc`), ignored while typing, with a
 * modifier held, or while `enabled` is false. */
export function useShortcuts(keys: Record<string, (e: KeyboardEvent) => void>, enabled: boolean) {
  const latest = useRef(keys)
  latest.current = keys
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const action = latest.current[e.key === 'Escape' ? 'esc' : e.key]
      if (!action) return
      e.preventDefault()
      action(e)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** ⌘↵ (Ctrl+↵ elsewhere) in a text field submits it. */
export const onSubmitKey = (submit: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
  e.preventDefault()
  submit()
}
