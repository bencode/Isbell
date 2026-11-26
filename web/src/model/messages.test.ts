import { describe, expect, test } from 'vitest'
import { feed, type Message, parseLink, parseMessages } from './messages'

const message = (id: number, time: number, replies: number[] = []): Message => ({
  id,
  time,
  kind: 'info',
  title: `M${id}`,
  replies: replies.map(at => ({ time: at, text: 'again' })),
})

describe('parseMessages', () => {
  test('reads what the CLI writes, with no replies as none', () => {
    const text = JSON.stringify({
      version: 1,
      last: 2,
      messages: [
        {
          id: 2,
          time: 5,
          kind: 'ask',
          title: 'Open a PR?',
          task: 9,
          link: 'session:pi:a',
          from: { agent: 'pi', session: 'a', pane: 'w1:p1', role: '高斯', dir: '/w' },
          replies: [{ time: 6, text: 'Yes', role: '达芬奇' }],
        },
        { id: 1, time: 3, kind: 'info', text: 'Backed up' },
      ],
    })
    const book = parseMessages(text)
    expect(book?.messages.map(m => [m.id, m.replies.length])).toEqual([
      [2, 1],
      [1, 0],
    ])
    expect(book?.messages[0]?.from?.role).toBe('高斯')
  })

  test.each([
    ['not JSON', '{'],
    ['another version', '{"version":2,"messages":[]}'],
    ['a kind it does not know', '{"version":1,"messages":[{"id":1,"time":1,"kind":"urgent","title":"x"}]}'],
    [
      'a reply with no text',
      '{"version":1,"messages":[{"id":1,"time":1,"kind":"info","replies":[{"time":2}]}]}',
    ],
  ])('%s is no messages', (_, text) => {
    expect(parseMessages(text)).toBeUndefined()
  })
})

test('the messages of every machine, the latest active first: a reply brings one up', () => {
  const items = [
    { mid: 'a', message: message(3, 30) },
    { mid: 'a', message: message(1, 10, [40]) },
    { mid: 'b', message: message(2, 20) },
  ]
  expect(feed(items).map(({ mid, message }) => `${mid}/M${message.id}`)).toEqual(['a/M1', 'a/M3', 'b/M2'])
})

test.each([
  ['session:pi:01a1-ba21', { kind: 'session', agent: 'pi', id: '01a1-ba21' }],
  ['file:/w/notes.md', { kind: 'file', path: '/w/notes.md' }],
  ['project:/w', { kind: 'project', path: '/w' }],
  ['file:notes.md', undefined],
  ['session:pi', undefined],
  ['https://example.com', undefined],
])('the link %s', (link, found) => {
  expect(parseLink(link)).toEqual(found)
})
