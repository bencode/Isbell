// Frames too long for one DataChannel message, sent on a direct link as a run of pieces; the same
// format as isbell-proto's frame/pieces.rs.
//
//   message = frame | piece
//   piece   = u32be(0xFFFFFFFF) ‖ u8(last) ‖ bytes     the next bytes of a frame's binary encoding
//
// A frame's binary encoding starts with its header length, which is never 0xFFFFFFFF, so a piece
// never passes for a frame. The channel is ordered and each side writes from one place, so a
// frame's pieces arrive back to back.

import { decode, encode, encodeBinary, type Frame, FrameError } from './frame'

/** Longest message a sender puts on the channel; browsers take up to 256 KiB. */
export const PIECE = 64 * 1024
/** Longest frame a receiver puts back together; herdr answers with at most 4 MiB. */
export const MAX_ASSEMBLED = 16 << 20

/** The mark and the `last` byte. */
const HEAD = 5
const MARK = 0xffffffff

const utf8 = new TextEncoder()

/** The frame as messages of at most `size` bytes: itself when it fits, else its pieces. */
export function split(frame: Frame, size = PIECE): (string | Uint8Array<ArrayBuffer>)[] {
  const whole = encode(frame)
  // UTF-8 takes at most 3 bytes per UTF-16 unit, so most text needs no encoding to measure.
  const fits =
    typeof whole === 'string'
      ? whole.length * 3 <= size || utf8.encode(whole).length <= size
      : whole.length <= size
  if (fits) return [whole]
  const bytes = encodeBinary(frame)
  const step = size - HEAD
  const count = Math.ceil(bytes.length / step)
  return Array.from({ length: count }, (_, i) => {
    const part = bytes.subarray(i * step, (i + 1) * step)
    const piece = new Uint8Array(HEAD + part.length)
    new DataView(piece.buffer).setUint32(0, MARK)
    piece[4] = i + 1 === count ? 1 : 0
    piece.set(part, HEAD)
    return piece
  })
}

const isPiece = (bytes: Uint8Array) =>
  bytes.length >= HEAD && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === MARK

/**
 * Puts frames back together from a channel's messages, pieces or whole: each message gives the
 * frame it completes, or undefined while pieces keep coming. Throws FrameError for a frame it
 * cannot read; the next whole frame decodes again.
 */
export function createAssembler(): (msg: string | ArrayBuffer) => Frame | undefined {
  let held: Uint8Array[] = []
  let size = 0
  // The rest of a frame that went over MAX_ASSEMBLED is dropped up to its last piece.
  let skipping = false
  const reset = () => {
    held = []
    size = 0
  }
  return msg => {
    const bytes = typeof msg === 'string' ? undefined : new Uint8Array(msg)
    if (!bytes || !isPiece(bytes)) {
      if (size || skipping) {
        reset()
        skipping = false
        throw new FrameError("a frame arrived in the middle of another frame's pieces")
      }
      return decode(msg)
    }
    const last = bytes[4] !== 0
    if (skipping) {
      skipping = !last
      return undefined
    }
    const part = bytes.subarray(HEAD)
    if (size + part.length > MAX_ASSEMBLED) {
      reset()
      skipping = !last
      throw new FrameError(`a frame in pieces is over ${MAX_ASSEMBLED} bytes`)
    }
    held.push(part)
    size += part.length
    if (!last) return undefined
    const whole = new Uint8Array(size)
    held.reduce((at, p) => {
      whole.set(p, at)
      return at + p.length
    }, 0)
    reset()
    return decode(whole)
  }
}
