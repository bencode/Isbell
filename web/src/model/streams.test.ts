import { expect, test } from 'vitest'
import type { Frame, Header } from './frame'
import { createRouter, type DataFrame, type StreamEvents, WINDOW } from './streams'

/** A router whose sent frames are kept, with the stream events it reported. */
const setup = () => {
  const sent: Header[] = []
  const router = createRouter(frame => sent.push(frame.header), true)
  const data: DataFrame[] = []
  const ends: unknown[] = []
  const events: StreamEvents = { data: f => data.push(f), end: e => ends.push(e) }
  const frame = (header: Header, body?: Uint8Array): Frame => (body ? { header, body } : { header })
  return { sent, router, data, ends, events, frame }
}

test('data after the result reaches the stream, and half a window consumed is granted back once', async () => {
  const { sent, router, data, events, frame } = setup()
  const opening = router.open('m1', 'isbell.terminal', {}, 1000, events)
  router.handle(frame({ t: 'res', id: 1, ok: true, r: { paneId: null } }))
  router.handle(
    frame({ t: 'data', id: 1, k: 'frame', full: true, cols: 80, rows: 24 }, new Uint8Array([104, 105])),
  )
  const { stream } = await opening
  expect(data).toEqual([{ full: true, cols: 80, rows: 24, body: new Uint8Array([104, 105]) }])

  stream.consumed(WINDOW / 2 - 1)
  expect(sent.filter(h => h.t === 'credit')).toEqual([])
  stream.consumed(1)
  stream.consumed(1)
  expect(sent.filter(h => h.t === 'credit')).toEqual([{ t: 'credit', id: 1, n: WINDOW / 2, mid: 'm1' }])
})

test("a file's chunks reach its stream as bytes alone", async () => {
  const { router, data, events, frame } = setup()
  const opening = router.open('m1', 'isbell.file.read', { path: '/a.md' }, 1000, events)
  router.handle(frame({ t: 'res', id: 1, ok: true, r: { size: 2 } }))
  await opening
  router.handle(frame({ t: 'data', id: 1, k: 'chunk' }, new Uint8Array([104, 105])))
  expect(data).toEqual([{ full: false, body: new Uint8Array([104, 105]) }])
})

test('losing the link ends an open stream once, and nothing more is sent on it', async () => {
  const { sent, router, ends, events, frame } = setup()
  const opening = router.open('m1', 'isbell.terminal', {}, 1000, events)
  router.handle(frame({ t: 'res', id: 1, ok: true }))
  const { stream } = await opening

  router.fail(() => true, 'disconnected', 'lost the connection to the relay')
  router.fail(() => true, 'disconnected', 'lost the connection to the relay')
  expect(ends).toEqual([{ code: 'disconnected', msg: 'lost the connection to the relay' }])

  const before = sent.length
  stream.send('input', undefined, new Uint8Array([1]))
  stream.close()
  expect(sent.length).toBe(before)
})

test("a write hears the far side's credit, and how it ends after this side finished", async () => {
  const { sent, router, ends, frame } = setup()
  const credits: number[] = []
  const events: StreamEvents = { data: () => {}, end: e => ends.push(e), credit: n => credits.push(n) }
  const opening = router.open('m1', 'isbell.file.upload', { name: 'a.png', size: 2 }, 1000, events)
  router.handle(frame({ t: 'res', id: 1, ok: true, r: { path: '/t/a.png' } }))
  const { stream } = await opening
  router.handle(frame({ t: 'credit', id: 1, n: WINDOW }))
  expect(credits).toEqual([WINDOW])

  stream.send('chunk', undefined, new Uint8Array([1, 2]))
  stream.finish()
  expect(sent.slice(-2)).toEqual([
    { t: 'data', id: 1, k: 'chunk', mid: 'm1' },
    { t: 'end', id: 1, mid: 'm1' },
  ])
  router.handle(frame({ t: 'end', id: 1 }))
  expect(ends).toEqual([undefined])
})
