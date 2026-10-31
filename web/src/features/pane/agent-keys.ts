// Working an agent through its own screen: send keys or a command, then read the screen until it
// shows what came of them, since it takes a moment to draw.

import { type Caller, prompt, readScreen, sendKeys } from '../../model/herdr'

// How often the screen is read after a step, and how many times before taking it as it is.
const READ_EVERY_MS = 300
const READS = 5

export type Pane = { call: Caller; mid: string; paneId: string; kind: string | undefined }

export const press = (pane: Pane, keys: string[]) => sendKeys(pane.call, pane.mid, pane.paneId, keys)

export const submit = (pane: Pane, text: string) => prompt(pane.call, pane.mid, pane.paneId, text)

/** Reads the screen until `done` holds for what `read` makes of it: the last read when it never does. */
export async function until<T>(pane: Pane, read: (text: string) => T, done: (t: T) => boolean): Promise<T> {
  for (let n = 1; ; n += 1) {
    await new Promise(wake => setTimeout(wake, READ_EVERY_MS))
    const now = read(await readScreen(pane.call, pane.mid, pane.paneId, 'visible'))
    if (done(now) || n === READS) return now
  }
}
