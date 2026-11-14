// A record's JSON lines from a part of the file read: whole lines only, the cut one at the front
// kept to be joined with the part before it; and those that still stand once the user went back.
// As web/src/model/chat/lines.ts.

import Foundation
import os

private let newline = UInt8(ascii: "\n")

/// `atStart`: the bytes begin the file, so their first line is whole.
public func splitLines(_ bytes: Data, atStart: Bool) -> (lines: [JSON], head: Data?) {
    let bytes = Data(bytes)  // indices from 0
    let first = atStart ? 0 : (bytes.firstIndex(of: newline).map { $0 + 1 } ?? 0)
    // No line ends here: all of it is the front of a line that began before.
    if !atStart && first == 0 { return ([], bytes) }
    // A line still being written is left for the next read.
    let last = bytes.lastIndex(of: newline) ?? -1
    let body = last < first ? Data() : bytes[first..<last]
    let lines = body.split(separator: newline).compactMap(lineValue)
    return (lines, atStart ? nil : bytes.prefix(first))
}

/// Where the lines read end: after the last newline, or where they began when there is none.
public func endOf(_ bytes: Data, from: Int) -> Int {
    from + (bytes.lastIndex(of: newline).map { $0 - bytes.startIndex + 1 } ?? 0)
}

/// A line's place in the conversation: what it follows, and whether it is something the user asked.
struct Node {
    var id: String
    var parent: String
    var asks: Bool
}

/// The lines without those the user went back on: where two questions follow the same line, as when
/// the conversation is rewound and asked anew, the earlier question and what followed it are dropped.
/// Lines are in the order written, a line after the one it follows.
func standing(_ lines: [JSON], nodeOf: (JSON) -> Node?) -> [JSON] {
    let nodes = lines.map(nodeOf)
    var asked: [String: String] = [:]
    var dropped: Set<String> = []
    for case let node? in nodes where node.asks && !node.parent.isEmpty {
        if let was = asked[node.parent] { dropped.insert(was) }
        asked[node.parent] = node.id
    }
    if dropped.isEmpty { return lines }
    for case let node? in nodes where dropped.contains(node.parent) { dropped.insert(node.id) }
    return zip(lines, nodes).compactMap { line, node in
        node.map { dropped.contains($0.id) } == true ? nil : line
    }
}

/// A line as JSON; one that does not read is skipped, as a record can be cut short.
private func lineValue(_ line: Data) -> JSON? {
    guard line.contains(where: { $0 != 0x20 && $0 != 0x09 && $0 != 0x0D }) else { return nil }
    do {
        return value(of: try JSONSerialization.jsonObject(with: line, options: [.fragmentsAllowed]))
    } catch {
        logger.warning("skipping an unreadable line of a session record: \(error)")
        return nil
    }
}

/// Foundation's parsed JSON as JSON; it parses records many times faster than decoding JSON itself.
private func value(of any: Any) -> JSON {
    switch any {
    case let s as String: return .string(s)
    case let n as NSNumber:
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
        return CFNumberIsFloatType(n) ? .double(n.doubleValue) : .int(n.int64Value)
    case let a as [Any]: return .array(a.map(value(of:)))
    case let o as [String: Any]: return .object(o.mapValues(value(of:)))
    default: return .null
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "chat")
