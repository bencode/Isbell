// A machine's files through its gateway: a directory one level at a time, files searched by path,
// and a file read as a stream. Paths sent are absolute.

import type { RpcError } from '../frame'
import type { Caller } from '../herdr'
import type { Space } from '../space'
import { CallError, WINDOW } from '../streams'

export type Entry = { name: string; kind: 'dir' | 'file' | 'other'; size?: number; mtime?: number }
/** `total` counts the directory's entries; more than `entries` when the listing was cut. */
export type Listing = { entries: Entry[]; total: number; truncated: boolean }
/** Paths relative to the root searched, shallow first. */
export type Found = { paths: string[]; truncated: boolean }
/** `bytes` is left out when the file is larger than the reader's limit. */
export type FileRead = { size: number; mtime?: number; bytes?: Uint8Array<ArrayBuffer> }

/** Above this a file is not read for its preview, only offered for download. */
export const PREVIEW_MAX = 5 << 20

/** The gateway stops a search after 2 s; the rest is the trip. */
const CALL_TIMEOUT_MS = 20_000

export const list = async (call: Caller, mid: string, path: string) =>
  (await call(mid, 'isbell.file.list', { path }, CALL_TIMEOUT_MS)) as Listing

export const search = async (call: Caller, mid: string, root: string, query: string) =>
  (await call(mid, 'isbell.file.search', { root, query }, CALL_TIMEOUT_MS)) as Found

/** Reads the file at `path` whole, or only its size and time when it is larger than `limit`. */
export async function read(
  open: Space['openStream'],
  mid: string,
  path: string,
  limit: number,
): Promise<FileRead> {
  const chunks: Uint8Array[] = []
  let received = 0
  let settle: (error?: RpcError) => void = () => {}
  const ended = new Promise<RpcError | undefined>(resolve => {
    settle = resolve
  })
  // No data comes before credit is granted, by which time `stream` is set.
  const { result, stream } = await open(mid, 'isbell.file.read', { path }, CALL_TIMEOUT_MS, {
    data: ({ body }) => {
      chunks.push(body)
      received += body.length
      // A file that grew past the limit while being read stops here, as if seen too large.
      if (received > limit) {
        stream.close()
        settle()
      } else stream.consumed(body.length)
    },
    end: settle,
  })
  const { size, mtime } = result as { size: number; mtime?: number }
  const opened = mtime === undefined ? { size } : { size, mtime }
  if (size > limit) {
    stream.close()
    return opened
  }
  stream.grant(WINDOW)
  const error = await ended
  if (error) throw new CallError(error.code, error.msg)
  if (received > limit) return { ...opened, size: received }
  const bytes = new Uint8Array(received)
  chunks.reduce((at, chunk) => {
    bytes.set(chunk, at)
    return at + chunk.length
  }, 0)
  return { ...opened, bytes }
}
