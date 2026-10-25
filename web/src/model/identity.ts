// Space identity, as crates/isbell-proto/src/identity.rs defines it:
//
//   key string = "isbk1-" ‖ base32lower(secret ‖ sha256(secret)[0..2])
//   seed       = HKDF-SHA256(ikm = secret, salt = ∅, info = "isbell-ed25519-v1", L = 32)
//   (sk, pk)   = Ed25519(seed)
//   sid        = base32lower(sha256(pk))[0..16]

import * as ed from '@noble/ed25519'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { base32nopad, base64urlnopad } from '@scure/base'

ed.hashes.sha512 = sha512

const KEY_PREFIX = 'isbk1-'
const SECRET_LEN = 16
const CHECKSUM_LEN = 2
const SEED_INFO = new TextEncoder().encode('isbell-ed25519-v1')
const AUTH_DOMAIN = 'isbell-auth-v1'
const SID_LEN = 16

export type Role = 'client' | 'gateway'

export type Identity = { key: string; pk: string; sid: string; seed: Uint8Array }

export class KeyError extends Error {
  constructor(
    readonly reason: 'prefix' | 'encoding' | 'checksum',
    options?: ErrorOptions,
  ) {
    super(`invalid space key: ${reason}`, options)
  }
}

export function parseKey(input: string): Identity {
  const key = input.trim()
  if (!key.startsWith(KEY_PREFIX)) throw new KeyError('prefix')
  const bytes = decodeBase32(key.slice(KEY_PREFIX.length))
  if (bytes.length !== SECRET_LEN + CHECKSUM_LEN) throw new KeyError('encoding')
  const secret = bytes.subarray(0, SECRET_LEN)
  const checksum = sha256(secret).subarray(0, CHECKSUM_LEN)
  if (!checksum.every((b, i) => b === bytes[SECRET_LEN + i])) throw new KeyError('checksum')
  const seed = hkdf(sha256, secret, undefined, SEED_INFO, 32)
  const pk = ed.getPublicKey(seed)
  return {
    key: KEY_PREFIX + base32nopad.encode(bytes).toLowerCase(),
    pk: base64urlnopad.encode(pk),
    sid: base32nopad.encode(sha256(pk)).toLowerCase().slice(0, SID_LEN),
    seed,
  }
}

function decodeBase32(text: string): Uint8Array {
  try {
    return base32nopad.decode(text.toUpperCase())
  } catch (err) {
    throw new KeyError('encoding', { cause: err })
  }
}

export const authMessage = (role: Role, origin: string, nonce: string): string =>
  `${AUTH_DOMAIN}\n${role}\n${origin}\n${nonce}`

export const signAuth = (id: Identity, role: Role, origin: string, nonce: string): string =>
  base64urlnopad.encode(ed.sign(new TextEncoder().encode(authMessage(role, origin, nonce)), id.seed))

/** `scheme://host[:port]` of a ws/wss URL, as the relay signs it into its challenge. */
export function originOf(url: string): string | undefined {
  const sep = url.indexOf('://')
  if (sep < 0) return undefined
  const scheme = url.slice(0, sep).toLowerCase()
  if (scheme !== 'ws' && scheme !== 'wss') return undefined
  const authority = url.slice(sep + 3).split(/[/?#]/)[0] ?? ''
  return authority ? `${scheme}://${authority.toLowerCase()}` : undefined
}
