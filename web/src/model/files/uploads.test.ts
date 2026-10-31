import { expect, test } from 'vitest'
import { splitUploads } from './uploads'

test('the images uploaded with a prompt are told from its words and other paths', () => {
  const prompt = [
    'what board is this?',
    'compare with docs/board.md',
    '/var/folders/6b/T/isbell-uploads/acc631d9/IMG_0298.jpeg',
    '/tmp/isbell-uploads/0f1e2d3c/manual.pdf',
    '  /tmp/isbell-uploads/9a8b7c6d/back.PNG',
    '/var/folders/6b/T/isbell-uploads/998b9cea/248.HEIC',
  ].join('\n')
  expect(splitUploads(prompt)).toEqual({
    text: 'what board is this?\ncompare with docs/board.md\n/tmp/isbell-uploads/0f1e2d3c/manual.pdf',
    images: [
      '/var/folders/6b/T/isbell-uploads/acc631d9/IMG_0298.jpeg',
      '/tmp/isbell-uploads/9a8b7c6d/back.PNG',
      '/var/folders/6b/T/isbell-uploads/998b9cea/248.HEIC',
    ],
  })
})
