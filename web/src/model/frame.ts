// Frames on the wire, as crates/isbell-proto/src/frame defines them:
//
//   text message   = JSON(header)
//   binary message = u32be(headerLen) ‖ JSON(header) ‖ body

import type { MachineInfo } from './state'

export type RpcError = { code: string; msg: string }

export type DataKind = 'frame' | 'input' | 'resize' | 'ping' | 'chunk'

type Routed = { mid?: string; from?: string; to?: string }

export type Header =
  | { t: 'challenge'; nonce: string; origin: string }
  | { t: 'auth'; role: 'client' | 'gateway'; pk: string; sig: string; machine?: MachineInfo }
  | { t: 'auth_ok'; sid: string; conn: string }
  | ({ t: 'call'; id: number; m: string; p: unknown } & Routed)
  | ({ t: 'res'; id: number; ok: boolean; r?: unknown; e?: RpcError } & Routed)
  | ({ t: 'data'; id: number; k: DataKind; full?: boolean; cols?: number; rows?: number } & Routed)
  | ({ t: 'end'; id: number; e?: RpcError } & Routed)
  | ({ t: 'credit'; id: number; n: number } & Routed)
  | { t: 'state'; state: unknown }
  | { t: 'presence'; mid: string; online: boolean }
  | { t: 'snapshot'; machines: { state: unknown; online: boolean }[] }

/** A frame; an empty body is normalized to none. */
export type Frame = { header: Header; body?: Uint8Array }

export class FrameError extends Error {}

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder('utf-8', { fatal: true })

/** Text when there is no body, binary otherwise. Absent fields are left out of the JSON. */
export function encode(frame: Frame): string | Uint8Array<ArrayBuffer> {
  return frame.body?.length ? encodeBinary(frame) : JSON.stringify(frame.header)
}

/** `u32be(headerLen) ‖ header ‖ body`, with or without a body. */
export function encodeBinary({ header, body }: Frame): Uint8Array<ArrayBuffer> {
  const head = utf8.encode(JSON.stringify(header))
  const tail = body ?? new Uint8Array()
  const out = new Uint8Array(4 + head.length + tail.length)
  new DataView(out.buffer).setUint32(0, head.length)
  out.set(head, 4)
  out.set(tail, 4 + head.length)
  return out
}

export function decode(msg: string | ArrayBuffer | Uint8Array): Frame {
  if (typeof msg === 'string') return { header: parseHeader(msg) }
  const bytes = msg instanceof Uint8Array ? msg : new Uint8Array(msg)
  if (bytes.length < 4) throw new FrameError('binary frame is truncated')
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (len > bytes.length - 4) throw new FrameError('binary frame is truncated')
  const header = parseHeader(fromUtf8.decode(bytes.subarray(4, 4 + len)))
  const body = bytes.slice(4 + len)
  return body.length ? { header, body } : { header }
}

function parseHeader(json: string): Header {
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object' || value === null || typeof (value as { t?: unknown }).t !== 'string') {
    throw new FrameError('invalid frame header')
  }
  return value as Header
}
