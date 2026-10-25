import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { stitch } from './history'

// A real finished Codex session, as windows of it would come.
const all = readFileSync(new URL('./fixtures/codex-done.txt', import.meta.url), 'utf8').split('\n')

test('overlapping windows join into the history they share', () => {
  expect(stitch(all.slice(0, 60), all.slice(30))).toEqual(all)
})

test('what the older window had at the bottom then gives way to the newer one', () => {
  const then = [...all.slice(0, 60), '› Ask Codex to do anything', '', '  GPT-5.6-Sol high · ~/work']
  expect(stitch(then, all.slice(40))).toEqual(all)
})

test('windows that do not meet are not joined', () => {
  expect(stitch(all.slice(0, 30), all.slice(45))).toBeNull()
  expect(stitch(all, ['', ...Array(25).fill(''), 'end'])).toBeNull()
})
