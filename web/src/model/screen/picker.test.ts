import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readPicker } from './picker'

// Screens recorded with `herdr agent read --source visible` while each menu was open.
const screen = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')

test("Claude Code's /model menu: a window of its models, the effort, and the keys", () => {
  const p = readPicker(screen('claude-model-picker'))
  expect(p?.heading[0]).toBe('Select model')
  expect(p?.items).toHaveLength(10)
  expect(p?.items[0]).toEqual({
    n: 1,
    label: 'Default (recommended)',
    note: 'Opus 5.5 · Best for everyday, complex tasks',
    current: true,
  })
  expect(p?.items[9]).toMatchObject({ n: 10, label: 'Opus 4.8', current: false })
  expect(p).toMatchObject({ cursor: 1, more: 3, effort: 'High' })
  expect(p?.keys).toEqual([
    { key: 'Enter', label: 'set as default' },
    { key: 's', label: 'use this session only' },
    { key: 'Esc', label: 'cancel' },
  ])
})

test('the question before switching a model mid-session is a menu without a keys line', () => {
  const p = readPicker(screen('claude-switch-confirm'))
  expect(p?.heading).toEqual([
    'Switch model?',
    'Your next response will be slower and use more tokens',
    expect.stringMatching(/^This conversation is cached/),
  ])
  expect(p?.items.map(i => i.label)).toEqual(['Yes, switch to Sonnet 5.5', 'No, go back'])
  expect(p).toMatchObject({ cursor: 1, more: 0, keys: [] })
})

test("Codex's /model menu, then the effort of the model chosen", () => {
  const models = readPicker(screen('codex-model-picker'))
  expect(models?.heading).toEqual(['Select Model and Effort'])
  expect(models?.items).toHaveLength(8)
  expect(models?.items[0]).toMatchObject({ n: 1, label: 'GPT-6.1-Sol', current: true })
  expect(models?.keys).toEqual([
    { key: 'enter', label: 'select' },
    { key: 'esc', label: 'back' },
  ])
  const effort = readPicker(screen('codex-effort-picker'))
  expect(effort?.heading).toEqual(['Select Reasoning Level for GPT-6.1-Sol'])
  expect(effort?.items.map(i => i.label)).toEqual([
    'Low (default)',
    'Medium',
    'High',
    'Extra high',
    'More reasoning…',
  ])
  expect(effort?.cursor).toBe(3)
  expect(effort?.effort).toBeUndefined()
  expect(effort?.items[2]?.current).toBe(true)
  expect(effort?.keys.map(k => k.key)).toEqual(['enter', 's', 'esc'])
})

test('a numbered list in a reply, above the input box, is not a menu', () => {
  expect(readPicker(screen('claude-done'))).toBeUndefined()
  expect(readPicker(screen('codex-done'))).toBeUndefined()
})
