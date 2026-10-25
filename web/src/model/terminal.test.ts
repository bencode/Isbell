import { afterEach, expect, test, vi } from 'vitest'
import type { Space, Via } from './space'
import type { Stream } from './streams'
import { openTerminal } from './terminal'

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

/** A terminal on a space that opens every stream over `via`, with the input frames it sent. */
async function terminalOver(via: Via) {
  const inputs: string[] = []
  const stream: Stream = {
    send: (k, _size, body) => {
      if (k === 'input') inputs.push(fromUtf8.decode(body))
    },
    grant: () => {},
    consumed: () => {},
    close: () => {},
  }
  const space = { openStream: async () => ({ result: {}, stream, via }) } as unknown as Space
  const terminal = await openTerminal(
    space,
    'm',
    { target: 'w1:p1' },
    { cols: 80, rows: 24 },
    { output: () => {}, size: () => {}, end: () => {} },
  )
  return { terminal, inputs, type: (keys: string) => [...keys].map(k => terminal.input(utf8.encode(k))) }
}

afterEach(() => vi.useRealTimers())

test('on the relay, keys typed within 30ms go out as one frame, and closing sends what is left', async () => {
  vi.useFakeTimers()
  const { terminal, inputs, type } = await terminalOver('relay')

  type('abc')
  expect(inputs).toEqual([])
  vi.advanceTimersByTime(30)
  expect(inputs).toEqual(['abc'])

  type('d')
  terminal.close()
  expect(inputs).toEqual(['abc', 'd'])
})

test('on a direct link, each key goes out at once', async () => {
  const { terminal, inputs, type } = await terminalOver('lan')
  type('ab')
  expect(inputs).toEqual(['a', 'b'])
  terminal.close()
})
