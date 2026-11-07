import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** ↵ submits a text field and ⇧↵ starts a new line; ⌘↵ (Ctrl+↵) submits as well. While an input
 * method is composing, ↵ picks its candidate instead (Safari reports that ↵ as keyCode 229). */
export const onSubmitKey = (submit: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
  e.preventDefault()
  submit()
}
