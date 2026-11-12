// A machine's files through its gateway: a directory one level at a time, files searched by path,
// a repository's worktrees, a file read as a stream, a file sent for an agent, and text written to a
// file. Paths sent are absolute.

import type { RpcError } from '../frame'
import type { Caller } from '../herdr'
import type { Space } from '../space'
import { CallError, WINDOW } from '../streams'
import type { Worktree } from './worktrees'

/** Whether `err` says there is no such file or directory there. */
export const isMissing = (err: unknown) =>
  err instanceof CallError && ['not_found', 'not_a_directory'].includes(err.code)

export type Entry = { name: string; kind: 'dir' | 'file' | 'other'; size?: number; mtime?: number }
/** `total` counts the directory's entries; more than `entries` when the listing was cut. */
export type Listing = { entries: Entry[]; total: number; truncated: boolean }
/** Paths relative to the root searched, shallow first. */
export type Found = { paths: string[]; truncated: boolean }
/** `bytes` is left out when the file is larger than the reader's limit. */
export type FileRead = { size: number; mtime?: number; offset?: number; bytes?: Uint8Array<ArrayBuffer> }

/** Above this a file is not read for its preview, only offered for download. */
export const PREVIEW_MAX = 5 << 20

/** Over this a file is not sent. */
export const UPLOAD_MAX = 20 << 20

/** The gateway stops a search after 2 s; the rest is the trip. */
const CALL_TIMEOUT_MS = 20_000
/** Largest chunk body, as isbell-proto's flow.rs sets it. */
const MAX_CHUNK = 63 * 1024
/** Over the relay a client may send 50 messages a second, and the page sends others meanwhile; one
 * chunk every 40ms leaves them room. */
const CHUNK_EVERY_MS = 40

export const list = async (call: Caller, mid: string, path: string) =>
  (await call(mid, 'isbell.file.list', { path }, CALL_TIMEOUT_MS)) as Listing

export const worktrees = async (call: Caller, mid: string, path: string) =>
  ((await call(mid, 'isbell.git.worktrees', { path }, CALL_TIMEOUT_MS)) as { worktrees: Worktree[] })
    .worktrees

export const search = async (call: Caller, mid: string, root: string, query: string) =>
  (await call(mid, 'isbell.file.search', { root, query }, CALL_TIMEOUT_MS)) as Found

/** Where a read starts, in bytes from the start or from the end, and how much of it is wanted. */
export type Range = { offset?: number; tail?: number; want?: number }

/**
 * Reads the file at `path`, or only its size and time when what is read would be larger than
 * `limit`. With `range`, from where it says, as far as it wants: `offset` then says where the bytes
 * begin. A gateway too old for ranges reads from the start and gives no `offset`. With `previous`,
 * a read of the same file with the same `limit` and `range`, a file found as it was then is not sent
 * again: `previous` itself comes back.
 */
export async function read(
  open: Space['openStream'],
  mid: string,
  path: string,
  limit: number,
  range: Range = {},
  previous?: FileRead,
): Promise<FileRead> {
  const chunks: Uint8Array[] = []
  let received = 0
  // Where a read that wants less than the rest stops; otherwise it goes to the end.
  let stopAt = Number.POSITIVE_INFINITY
  let settle: (error?: RpcError) => void = () => {}
  const ended = new Promise<RpcError | undefined>(resolve => {
    settle = resolve
  })
  const { offset, tail, want } = range
  const params = {
    path,
    ...(offset === undefined ? {} : { offset }),
    ...(tail === undefined ? {} : { tail }),
  }
  // No data comes before credit is granted, by which time `stream` is set.
  const { result, stream } = await open(mid, 'isbell.file.read', params, CALL_TIMEOUT_MS, {
    data: ({ body }) => {
      chunks.push(body)
      received += body.length
      // Enough is read, or the file grew past the limit while being read: it stops here.
      if (received >= stopAt || received > limit) {
        stream.close()
        settle()
      } else stream.consumed(body.length)
    },
    end: settle,
  })
  const r = result as { size: number; mtime?: number; offset?: number }
  const opened: FileRead = {
    size: r.size,
    ...(r.mtime === undefined ? {} : { mtime: r.mtime }),
    ...(r.offset === undefined ? {} : { offset: r.offset }),
  }
  if (previous && unchanged(previous, opened)) {
    stream.close()
    return previous
  }
  const rest = r.size - (r.offset ?? 0)
  const need = Math.min(want ?? rest, rest)
  if (need > limit) {
    stream.close()
    return opened
  }
  if (need <= 0) {
    stream.close()
    return { ...opened, bytes: new Uint8Array(0) }
  }
  if (need < rest) stopAt = need
  stream.grant(Math.min(stopAt, WINDOW))
  const error = await ended
  if (error) throw new CallError(error.code, error.msg)
  // More than asked for can come when the credit given runs ahead; only what was asked counts.
  if (Math.min(received, stopAt) > limit) return { ...opened, size: received }
  const bytes = new Uint8Array(Math.min(received, stopAt))
  chunks.reduce((at, chunk) => {
    bytes.set(chunk.subarray(0, Math.max(0, bytes.length - at)), at)
    return at + chunk.length
  }, 0)
  return { ...opened, bytes }
}

/** The file is as `previous` read it: the same size and time, from the same place. One whose time
 * is not kept is never taken for unchanged. */
const unchanged = (previous: FileRead, opened: FileRead) =>
  opened.mtime !== undefined &&
  opened.mtime === previous.mtime &&
  opened.size === previous.size &&
  opened.offset === previous.offset

/** Sends `bytes` to machine `mid` as a file named `name` for an agent, as fast as the machine grants
 * credit and the pace allows; resolves to the file's absolute path there. */
export async function upload(
  open: Space['openStream'],
  mid: string,
  name: string,
  bytes: Uint8Array,
  progress: (sent: number) => void,
): Promise<string> {
  const result = await send(open, mid, 'isbell.file.upload', { name, size: bytes.length }, bytes, progress)
  return (result as { path: string }).path
}

/** Replaces the file at `path` with `text`, whole or not at all; its directory must be there. */
export async function writeText(open: Space['openStream'], mid: string, path: string, text: string) {
  const bytes = new TextEncoder().encode(text)
  await send(open, mid, 'isbell.file.write', { path, size: bytes.length }, bytes, () => {})
}

/** Sends `bytes` on a stream opened with `method`, as fast as credit and the relay allow; the
 * stream's result once the machine has them all. */
async function send(
  open: Space['openStream'],
  mid: string,
  method: string,
  params: unknown,
  bytes: Uint8Array,
  progress: (sent: number) => void,
): Promise<unknown> {
  let credit = 0
  let over = false
  let wake = () => {}
  let settle: (error?: RpcError) => void = () => {}
  const ended = new Promise<RpcError | undefined>(resolve => {
    settle = resolve
  })
  const { result, stream } = await open(mid, method, params, CALL_TIMEOUT_MS, {
    data: () => {},
    credit: n => {
      credit += n
      wake()
    },
    end: error => {
      over = true
      settle(error)
      wake()
    },
  })
  const changed = () =>
    new Promise<void>(resolve => {
      wake = resolve
    })
  let sent = 0
  while (sent < bytes.length && !over) {
    const chunk = bytes.subarray(sent, sent + MAX_CHUNK)
    while (credit < chunk.length && !over) await changed()
    await new Promise(resolve => setTimeout(resolve, CHUNK_EVERY_MS))
    if (over) break
    stream.send('chunk', undefined, chunk)
    credit -= chunk.length
    sent += chunk.length
    progress(sent)
  }
  if (!over) stream.finish()
  const error = await ended
  if (error) throw new CallError(error.code, error.msg)
  return result
}
