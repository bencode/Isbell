import { hex } from '@scure/base'
import { describe, expect, test } from 'vitest'
import vectors from '../../../crates/isbell-proto/tests/vectors.json' with { type: 'json' }
import { decode, encode, type Header } from './frame'
import { authMessage, KeyError, parseKey, signAuth } from './identity'

describe('identity agrees with the Rust implementation', () => {
  const v = vectors.identity

  test('derives the same key, public key, sid and signature', () => {
    const id = parseKey(v.key)
    expect([id.key, id.pk, id.sid]).toEqual([v.key, v.pk, v.sid])
    expect(authMessage('client', v.origin, v.nonce)).toBe(v.authMessage)
    expect(signAuth(id, 'client', v.origin, v.nonce)).toBe(v.sig)
  })

  test.each(vectors.badKeys)('rejects $key for its $error', ({ key, error }) => {
    expect(() => parseKey(key)).toThrow(expect.objectContaining({ reason: error }))
    expect(() => parseKey(key)).toThrow(KeyError)
  })
})

describe('frames agree with the Rust implementation', () => {
  test.each(vectors.frames)('$header.t', frame => {
    const header = frame.header as Header
    const body = 'bodyHex' in frame ? hex.decode(frame.bodyHex) : undefined
    const wire = 'text' in frame ? frame.text : hex.decode(frame.binaryHex)
    expect(decode(wire)).toEqual(body ? { header, body } : { header })
    const encoded = encode(body ? { header, body } : { header })
    expect(typeof encoded).toBe(typeof wire)
    expect(decode(encoded)).toEqual(decode(wire))
  })
})
