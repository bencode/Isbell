import { expect, test } from 'vitest'
import type { Space } from '../space'
import type { Stream, StreamEvents } from '../streams'
import { read } from './remote'

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
