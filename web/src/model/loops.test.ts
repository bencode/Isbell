import { describe, expect, test } from 'vitest'
import { endedLoops, type Loop, parseLoops, serializeLoops } from './loops'

const loop = (id: string, paneId: string, project = '/w/a'): Loop => ({
  id,
  project,
  paneId,
  schedule: { dailyAt: '08:00' },
  message: 'go',
  enabled: true,
})

describe('parseLoops', () => {
  test('reads back what is written', () => {
    const loops = [loop('a', 'w1:p1'), { ...loop('b', 'w1:p2'), clearEvery: 3 }]
    expect(parseLoops(serializeLoops(loops))).toEqual(loops)
  })

  test.each([
    ['not JSON', '{'],
    ['JSON of no object', 'null'],
    ['another version', '{"version":2,"loops":[]}'],
    ['an entry with no schedule', '{"version":1,"loops":[{"id":"a"}]}'],
  ])('%s is no list, so it is never written over', (_, text) => {
    expect(parseLoops(text)).toBeUndefined()
  })
})

describe('endedLoops', () => {
  test('are those of the project whose agent is gone', () => {
    const loops = [loop('live', 'w1:p1'), loop('gone', 'w1:p2'), loop('other', 'w1:p3', '/w/b')]
    expect(endedLoops(loops, '/w/a', new Set(['w1:p1'])).map(l => l.id)).toEqual(['gone'])
  })
})
