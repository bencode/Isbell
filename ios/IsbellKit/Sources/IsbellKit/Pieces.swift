// Frames too long for one DataChannel message, sent on a direct link as a run of pieces; the same
// format as isbell-proto's frame/pieces.rs. As web/src/model/pieces.ts.
//
//   message = frame | piece
//   piece   = u32be(0xFFFFFFFF) ‖ u8(last) ‖ bytes     the next bytes of a frame's binary encoding
//
// A frame's binary encoding starts with its header length, which is never 0xFFFFFFFF, so a piece
// never passes for a frame. The channel is ordered and each side writes from one place, so a
// frame's pieces arrive back to back.

import Foundation

/// Longest message a sender puts on the channel.
public let piece = 64 * 1024
/// Longest frame a receiver puts back together; herdr answers with at most 4 MiB.
public let maxAssembled = 16 << 20

/// The mark and the `last` byte.
private let head = 5
private let mark: [UInt8] = [0xFF, 0xFF, 0xFF, 0xFF]

/// The frame as messages of at most `size` bytes: itself when it fits, else its pieces.
public func split(_ frame: Frame, size: Int = piece) -> [Message] {
    let whole = encode(frame)
    let length = switch whole {
    case .text(let text): text.utf8.count
    case .binary(let data): data.count
    }
    if length <= size { return [whole] }
    let bytes = encodeBinary(frame)
    let step = size - head
    let count = (bytes.count + step - 1) / step
    return (0..<count).map { i in
        let part = bytes[(bytes.startIndex + i * step)..<min(bytes.startIndex + (i + 1) * step, bytes.endIndex)]
        return .binary(Data(mark) + [i + 1 == count ? 1 : 0] + part)
    }
}

private func isPiece(_ bytes: Data) -> Bool {
    bytes.count >= head && bytes.prefix(4).elementsEqual(mark)
}

/// Puts frames back together from a channel's messages, pieces or whole.
public struct Assembler: Sendable {
    private var held = Data()
    // The rest of a frame that went over maxAssembled is dropped up to its last piece.
    private var skipping = false

    public init() {}

    /// The frame `message` completes, or nil while pieces keep coming. Throws FrameError for a frame
    /// it cannot read; the next whole frame decodes again.
    public mutating func take(_ message: Message) throws(FrameError) -> Frame? {
        guard case .binary(let raw) = message, isPiece(raw) else {
            if !held.isEmpty || skipping {
                held = Data()
                skipping = false
                throw FrameError(reason: "a frame arrived in the middle of another frame's pieces")
            }
            return try decode(message)
        }
        let bytes = Data(raw)  // indices from 0
        let last = bytes[4] != 0
        if skipping {
            skipping = !last
            return nil
        }
        let part = bytes.dropFirst(head)
        if held.count + part.count > maxAssembled {
            held = Data()
            skipping = !last
            throw FrameError(reason: "a frame in pieces is over \(maxAssembled) bytes")
        }
        held.append(part)
        guard last else { return nil }
        let whole = held
        held = Data()
        return try decode(.binary(whole))
    }
}
