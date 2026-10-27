import { expect, test } from 'vitest'
import { assetReader } from './assets'
import type { FileRead } from './remote'

test('a document reads each file once, three at a time, typed by name, and refuses one over the limit', async () => {
  const reads: string[] = []
  let running = 0
  let most = 0
  const readFile = async (rel: string): Promise<FileRead> => {
    reads.push(rel)
    running += 1
    most = Math.max(most, running)
    await new Promise(resolve => setTimeout(resolve))
    running -= 1
    return rel === 'huge.png' ? { size: 9 << 20 } : { size: 1, bytes: new Uint8Array([1]) }
  }
  const asset = assetReader(readFile)
  const rels = ['a.png', 'b.svg', 'c.png', 'a.png', 'd.gif', 'app.js']
  const blobs = await Promise.all(rels.map(asset))
  const huge = await asset('huge.png').then(
    () => 'read',
    () => 'refused',
  )

  expect(reads.filter(rel => rel === 'a.png')).toHaveLength(1)
  expect(most).toBe(3)
  expect(huge).toBe('refused')
  expect(blobs[1]?.type).toBe('image/svg+xml')
  expect(blobs[5]?.type).toBe('text/javascript;charset=utf-8')
})
