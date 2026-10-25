import { expect, test } from 'vitest'
import { type Path, pathOf } from './path'

test('a direct link is judged by the address it reaches the machine at', () => {
  const cases: [string, string | undefined, Path][] = [
    ['host', '192.168.1.20', 'lan'],
    ['host', '10.0.0.5', 'lan'],
    ['host', '172.20.3.4', 'lan'],
    ['host', '172.32.3.4', 'internet'],
    ['host', '100.69.122.127', 'vpn'],
    ['host', '100.128.0.1', 'internet'],
    ['srflx', '203.0.113.7', 'internet'],
    ['host', 'fd7a:115c:a1e0::1234', 'vpn'],
    ['host', 'fd12:3456::1', 'lan'],
    ['host', 'fe80::1', 'lan'],
    ['srflx', '2001:db8::1', 'internet'],
    ['host', '4b1c-mac-mini.local', 'lan'],
    ['relay', '10.0.0.5', 'internet'],
    ['host', undefined, 'lan'],
    ['srflx', undefined, 'internet'],
  ]
  const judged = cases.map(([type, address]) => [
    type,
    address,
    pathOf({ type, ...(address ? { address } : {}) }),
  ])
  expect(judged).toEqual(cases)
})
