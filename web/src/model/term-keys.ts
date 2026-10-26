// The keys a touch keyboard lacks, as the bytes a terminal program expects from them.

export type BarKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'enter'

const PLAIN: Partial<Record<BarKey, string>> = { esc: '\x1b', tab: '\t', enter: '\r' }
const ARROW: Partial<Record<BarKey, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' }

/** What a key on the bar sends; arrows follow the program's cursor-key mode (DECCKM). */
export const barKeyBytes = (key: BarKey, appCursor: boolean): string =>
  PLAIN[key] ?? `${appCursor ? '\x1bO' : '\x1b['}${ARROW[key]}`

/** `typed` with Ctrl held: a single letter or one of @ [ \ ] ^ _ becomes its control byte, a space
 * becomes NUL; anything else (a word from autocorrect, a digit) goes as typed. */
export const withCtrl = (typed: string): string => {
  if (typed === ' ') return '\x00'
  if (typed.length !== 1) return typed
  const code = typed.toUpperCase().charCodeAt(0)
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : typed
}
