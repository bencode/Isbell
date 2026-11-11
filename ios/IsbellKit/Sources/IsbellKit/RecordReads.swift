// A session's record, read in parts: the end of the file first, more before it as asked, and what
// is added while the agent works. As the reading part of web/src/core/chat-log.ts.

import Foundation

/// How much is read at a time: the end of the file, or the part before what is read.
private let partSize = 1 << 20
/// What is read first, back from the end, until it holds this many turns or this much.
private let firstTurns = 3
private let firstMax = 8 << 20
/// A gateway too old to read part of a file reads it whole, up to this.
private let wholeMax = 4 << 20

/// A record's lines from byte `start` to `end` of the file.
public struct RecordPart: Sendable, Equatable {
    public var lines: [JSON]
    public var start: Int
    public var end: Int
    /// The cut line before `start`, joined with the part before it once that is read.
    public var head: Data?
    /// The gateway reads files only whole: each read reads all of it again.
    public var whole: Bool
}

/// The end of the file, and more before it until it holds a few turns; nil when it is too large to
/// read.
@MainActor
public func readLast(_ open: Opener, mid: String, path: String, kind: String) async throws(CallError) -> RecordPart? {
    let got = try await readFile(open, mid: mid, path: path, limit: wholeMax, range: FileRange(tail: partSize))
    guard let bytes = got.bytes else { return nil }
    let start = got.offset ?? 0
    let (lines, head) = splitLines(bytes, atStart: start == 0)
    var part = RecordPart(lines: lines, start: start, end: endOf(bytes, from: start), head: head, whole: got.offset == nil)
    while part.start > 0 && part.end - part.start < firstMax && askedTurns(kind, part) < firstTurns {
        let was = part.start
        part = try await readBefore(open, mid: mid, path: path, part)
        if part.start == was { break }
    }
    return part
}

/// The part before what is read, its cut line joined to the part read before.
@MainActor
public func readBefore(_ open: Opener, mid: String, path: String, _ part: RecordPart) async throws(CallError) -> RecordPart {
    let offset = max(0, part.start - partSize)
    let range = FileRange(offset: offset, want: part.start - offset)
    let got = try await readFile(open, mid: mid, path: path, limit: partSize, range: range)
    guard let bytes = got.bytes else { return part }
    let (lines, head) = splitLines(bytes + (part.head ?? Data()), atStart: offset == 0)
    return RecordPart(lines: lines + part.lines, start: offset, end: part.end, head: head, whole: part.whole)
}

/// What was added since; nil when it is to be read from the end again: the file was written anew,
/// or the gateway reads files only whole.
@MainActor
public func readAfter(_ open: Opener, mid: String, path: String, _ part: RecordPart) async throws(CallError) -> RecordPart? {
    if part.whole { return nil }
    let got = try await readFile(open, mid: mid, path: path, limit: firstMax, range: FileRange(offset: part.end))
    guard got.size >= part.end, let bytes = got.bytes else { return nil }
    let end = endOf(bytes, from: part.end)
    if end == part.end { return part }
    var next = part
    next.lines += splitLines(bytes.prefix(end - part.end), atStart: true).lines
    next.end = end
    return next
}

/// The turns read whole: those whose question is read.
private func askedTurns(_ kind: String, _ part: RecordPart) -> Int {
    turnsOf(kind: kind, lines: part.lines).filter { $0.you != nil }.count
}
