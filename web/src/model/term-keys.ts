// The keys a touch keyboard lacks, as the bytes a terminal program expects from them.

export type BarKey =
  | 'esc'
  | 'interrupt'
  | 'tab'
  | 'backTab'
  | 'pageUp'
  | 'pageDown'
  | 'up'
  | 'down'
  | 'enter'
  | '1'
  | '2'
  | '3'

const PLAIN: Partial<Record<BarKey, string>> = {
  esc: '\x1b',
  interrupt: '\x03',
  tab: '\t',
  backTab: '\x1b[Z',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  enter: '\r',
  '1': '1',
  '2': '2',
  '3': '3',
}
const ARROW: Partial<Record<BarKey, string>> = { up: 'A', down: 'B' }

/** What a key on the bar sends; arrows follow the program's cursor-key mode (DECCKM). */
export const barKeyBytes = (key: BarKey, appCursor: boolean): string =>
  PLAIN[key] ?? `${appCursor ? '\x1bO' : '\x1b['}${ARROW[key]}`
