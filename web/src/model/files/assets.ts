// The files a document shows beside itself, read from its machine: a Markdown document's images, an
// HTML page's every file. Each is read once, and only a few at a time, since the gateway allows a
// connection 8 streams and terminals and chats need theirs.

import { CallError } from '../streams'
import { mediaType } from './content'
import type { FileRead } from './remote'

/** At most this many of a document's files are read at once. */
const AT_ONCE = 3

/** Reads the files of one document by their paths under the root: each path once, AT_ONCE at a
 * time, typed by name. A file larger than `readFile`'s limit rejects as `too_large`. */
export function assetReader(readFile: (rel: string) => Promise<FileRead>): (rel: string) => Promise<Blob> {
  const reads = new Map<string, Promise<Blob>>()
  const waiting: (() => void)[] = []
  let running = 0

  // A slot freed goes straight to the next read waiting, so none can slip in between.
  const acquire = () => {
    if (running < AT_ONCE) {
      running += 1
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      waiting.push(resolve)
    })
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }

  const readOne = async (rel: string) => {
    await acquire()
    try {
      const { bytes } = await readFile(rel)
      if (!bytes) throw new CallError('too_large', `${rel} is larger than the preview limit`)
      const type = mediaType(rel)
      return new Blob([bytes], type ? { type } : {})
    } finally {
      release()
    }
  }

  return rel => {
    const known = reads.get(rel)
    if (known) return known
    const blob = readOne(rel)
    reads.set(rel, blob)
    return blob
  }
}
