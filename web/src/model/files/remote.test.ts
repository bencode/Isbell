import { expect, test, vi } from 'vitest'
import type { RpcError } from '../frame'
import type { Space } from '../space'
import type { Stream, StreamEvents } from '../streams'
import { read, upload } from './remote'

/** A space whose file stream answers `result` and then, once credit comes, sends `chunks`. */
function serving(result: unknown, chunks: number[][], end?: { code: string; msg: string }) {
  const seen = { granted: 0, consumed: 0, closed: false }
  let events: StreamEvents | undefined
  const stream: Stream = {
    send: () => {},
    grant: n => {
      seen.granted += n
      for (const chunk of chunks) events?.data({ full: false, body: Uint8Array.from(chunk) })
      if (!seen.closed) events?.end(end)
    },
    consumed: n => {
      seen.consumed += n
    },
    close: () => {
      seen.closed = true
    },
    finish: () => {},
  }
  const open = (async (_mid, _m, _p, _timeout, e) => {
    events = e
    return { result, stream, via: 'relay' }
  }) as Space['openStream']
  return { open, seen }
}

test('a file arrives whole, and what was read is counted as consumed', async () => {
  const { open, seen } = serving({ size: 5, mtime: 9 }, [
    [104, 105],
    [33, 33, 10],
  ])
  const got = await read(open, 'm', '/a.md', 100)
  expect(got).toEqual({ size: 5, mtime: 9, bytes: Uint8Array.from([104, 105, 33, 33, 10]) })
  expect(seen.consumed).toBe(5)
})

test('a file over the limit is closed unread, or as soon as it grows past it', async () => {
  const big = serving({ size: 200 }, [[1]])
  expect(await read(big.open, 'm', '/big.bin', 100)).toEqual({ size: 200 })
  expect(big.seen).toEqual({ granted: 0, consumed: 0, closed: true })

  const growing = serving({ size: 2 }, [
    [1, 2],
    [3, 4],
  ])
  expect(await read(growing.open, 'm', '/log', 3)).toEqual({ size: 4 })
  expect(growing.seen.closed).toBe(true)
})

test('a read the machine ends with an error fails with it', async () => {
  const { open } = serving({ size: 1 }, [], { code: 'io_error', msg: 'disk' })
  await expect(read(open, 'm', '/a.md', 100)).rejects.toMatchObject({ code: 'io_error' })
})

/** A space whose upload stream grants `credit` at once, ends with `end` once finished, and keeps the
 * size of each chunk sent. */
function taking(credit: number, end?: RpcError) {
  const sent: number[] = []
  let events: StreamEvents | undefined
  const stream: Stream = {
    send: (_k, _size, body) => sent.push(body?.length ?? 0),
    grant: () => {},
    consumed: () => {},
    close: () => {},
    finish: () => events?.end(end),
  }
  const open = (async (_mid, _m, _p, _timeout, e) => {
    events = e
    queueMicrotask(() => e.credit?.(credit))
    return { result: { path: '/t/1f/a.png' }, stream, via: 'relay' }
  }) as Space['openStream']
  return { open, sent, more: (n: number) => events?.credit?.(n) }
}

test('an upload sends chunks only as credit allows, and resolves to where the file landed', async () => {
  const { open, sent, more } = taking(70 << 10)
  const progress: number[] = []
  const done = upload(open, 'm', 'a.png', new Uint8Array(100 << 10), n => progress.push(n))
  await vi.waitFor(() => expect(sent).toEqual([63 << 10]))
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(sent).toHaveLength(1)
  more(63 << 10)
  expect(await done).toBe('/t/1f/a.png')
  expect(sent).toEqual([63 << 10, 37 << 10])
  expect(progress).toEqual([63 << 10, 100 << 10])
})

test('an upload the machine ends with an error fails with it', async () => {
  const { open } = taking(1 << 20, { code: 'io_error', msg: 'disk full' })
  await expect(upload(open, 'm', 'a.png', new Uint8Array(10), () => {})).rejects.toMatchObject({
    code: 'io_error',
  })
})
