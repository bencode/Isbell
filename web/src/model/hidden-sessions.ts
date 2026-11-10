// The sessions a machine's lists leave out, by their key (see `sessionKey`): one tried once, or done
// with. They stay recorded, and a search still finds them.

import { STORE } from './sessions'

export const hiddenPath = `${STORE}/hidden.json`

const VERSION = 1

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

/** The keys `text` lists; undefined when it is no such file, which is never written over. */
export function parseHidden(text: string): string[] | undefined {
  const file = parsed(text) as { version?: unknown; hidden?: unknown } | null | undefined
  if (file?.version !== VERSION || !Array.isArray(file.hidden)) return undefined
  return file.hidden.every(key => typeof key === 'string') ? file.hidden : undefined
}

export const serializeHidden = (hidden: readonly string[]) =>
  `${JSON.stringify({ version: VERSION, hidden }, null, 2)}\n`
