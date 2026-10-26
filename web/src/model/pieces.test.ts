import { expect, test } from 'vitest'
import { encode, type Frame, FrameError } from './frame'
import { createAssembler, MAX_ASSEMBLED, PIECE, split } from './pieces'

const data = (id: number, body: Uint8Array): Frame => ({ header: { t: 'data', id, k: 'frame' }, body })
const res = (id: number, r: unknown): Frame => ({ header: { t: 'res', id, ok: true, r } })

/** What a channel hands over: binary messages as ArrayBuffers. */
const wire = (msg: string | Uint8Array<ArrayBuffer>) => (typeof msg === 'string' ? msg : msg.buffer)

test('a long frame goes in pieces and comes back whole', () => {
  const frame = data(
    7,
    Uint8Array.from({ length: 1 << 20 }, (_, i) => i % 251),
  )
  const msgs = split(frame)
  expect(msgs.length).toBeGreaterThan(16)
  expect(msgs.every(m => typeof m !== 'string' && m.length <= PIECE)).toBe(true)
  const assemble = createAssembler()
  const out = msgs.map(m => assemble(wire(m)))
  expect(out.slice(0, -1).every(f => f === undefined)).toBe(true)
  expect(out.at(-1)).toEqual(frame)
})

test('a frame that fits goes whole, as encode gives it', () => {
  const short = res(1, { text: 'ok' })
  expect(split(short)).toEqual([encode(short)])
  expect(createAssembler()(wire(encode(short)))).toEqual(short)
})

test('long text is measured in bytes, and goes in pieces', () => {
  // 30,000 CJK characters are 90,000 bytes in UTF-8, though only 30,000 UTF-16 units.
  const long = res(2, { text: '字'.repeat(30_000) })
  const msgs = split(long)
  expect(msgs.length).toBe(2)
  const assemble = createAssembler()
  expect(msgs.map(m => assemble(wire(m))).at(-1)).toEqual(long)
})

test('a frame over the cap is dropped, and the next one still decodes', () => {
  const assemble = createAssembler()
  const errors = split(data(1, new Uint8Array(MAX_ASSEMBLED + 1))).filter(m => {
    try {
      return assemble(wire(m)) !== undefined
    } catch (err) {
      return err instanceof FrameError
    }
  })
  expect(errors).toHaveLength(1)
  const next = data(2, Uint8Array.of(9))
  expect(assemble(wire(encode(next)))).toEqual(next)
})

test('a whole frame amid pieces is an error, and the next one decodes', () => {
  const assemble = createAssembler()
  const [first] = split(data(1, new Uint8Array(3 * PIECE)))
  const next = res(2, null)
  expect(first && assemble(wire(first))).toBeUndefined()
  expect(() => assemble(wire(encode(next)))).toThrow(FrameError)
  expect(assemble(wire(encode(next)))).toEqual(next)
})
