import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react'

// Where a key belongs to what has focus: text being typed, or a popup that closes on its own Esc.
const OWNS_KEYS =
  'input, textarea, select, [contenteditable="true"], [role=dialog], [role=menu], [role=listbox]'

/** Single-key shortcuts by `KeyboardEvent.key` (Escape as `esc`), ignored while typing or composing,
 * in a popup, with a modifier held, once something else has handled the key, or while `enabled` is
 * false. */
export function useShortcuts(keys: Record<string, (e: KeyboardEvent) => void>, enabled: boolean) {
  const latest = useRef(keys)
  latest.current = keys
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return
      const target = e.target as HTMLElement | null
      if (target?.closest(OWNS_KEYS)) return
      const action = latest.current[e.key === 'Escape' ? 'esc' : e.key]
      if (!action) return
      e.preventDefault()
      action(e)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** The palette's key, ⌘K on a Mac and Ctrl+K elsewhere, from anywhere: a text field or the terminal
 * too. A Mac's Ctrl+K is left alone, as text fields there cut to the end of the line with it. */
export const COMMAND_KEY = MAC ? '⌘K' : 'Ctrl K'

export function useCommandKey(open: () => void) {
  const latest = useRef(open)
  latest.current = open
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

/** A touch screen, whose keyboard has no Esc, Ctrl or arrows, and whose ↵ is its only way to a
 * new line (so there the send button sends). */
export const TOUCH = matchMedia('(pointer: coarse)').matches

/** ↵ submits a text field and ⇧↵ starts a new line; ⌘↵ (Ctrl+↵) submits as well, and on a touch
 * screen only it does. While an input method is composing, ↵ picks its candidate instead (Safari
 * reports that ↵ as keyCode 229). */
export const onSubmitKey = (submit: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
  if (TOUCH && !e.metaKey && !e.ctrlKey) return
  e.preventDefault()
  submit()
}
