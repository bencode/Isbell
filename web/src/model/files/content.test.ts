import { expect, test } from 'vitest'
import { decodeText, formatSize, kindOf } from './content'

test('a file is markdown, html, mermaid or text by its extension', () => {
  const names = [
    'a.md',
    'B.MARKDOWN',
    'x.html',
    'x.htm',
    'flow.mmd',
    'f.mermaid',
    'main.rs',
    'Makefile',
    '.env',
  ]
  expect(names.map(kindOf)).toEqual([
    'markdown',
    'markdown',
    'html',
    'html',
    'mermaid',
    'mermaid',
    'text',
    'text',
    'text',
  ])
})

test('bytes are text when they are UTF-8 without NUL', () => {
  expect(decodeText(new TextEncoder().encode('文件 ok'))).toBe('文件 ok')
  expect(decodeText(Uint8Array.of(104, 0, 105))).toBeNull()
  expect(decodeText(Uint8Array.of(0xff, 0xfe))).toBeNull()
})

test('sizes read in the nearest unit', () => {
  expect([0, 900, 6_350, 14 * 1024, 5 * 1024 ** 2].map(formatSize)).toEqual([
    '0 B',
    '900 B',
    '6.2 KB',
    '14 KB',
    '5.0 MB',
  ])
})
