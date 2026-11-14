import Foundation
import Testing

@testable import IsbellKit

// Samples from web/src/model/{pieces,vectors}.test.ts.

private func data(_ id: UInt64, _ body: Data) -> Frame {
    Frame(header: .data(id: id, k: .frame, full: nil, cols: nil, rows: nil, route: Route()), body: body)
}

private func res(_ id: UInt64, _ r: JSON) -> Frame {
    Frame(header: .res(id: id, ok: true, r: r, e: nil, route: Route()))
}

@Test func piecesAgreeWithTheRustImplementation() throws {
    let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let vectors = try JSONDecoder().decode(JSON.self, from: Data(contentsOf: root.appending(path: "crates/isbell-proto/tests/vectors.json")))
    let v = try #require(vectors["pieces"])
    let hex = { (text: String) in
        Data(stride(from: 0, to: text.count, by: 2).map { i in
            let start = text.index(text.startIndex, offsetBy: i)
            return UInt8(text[start..<text.index(start, offsetBy: 2)], radix: 16)!
        })
    }
    let frame = Frame(header: try decode(.text(jsonText(v["header"]!))).header, body: hex(v["bodyHex"]!.string!))
    guard case .array(let expected)? = v["piecesHex"], case .int(let size)? = v["size"] else {
        Issue.record("no pieces vector")
        return
    }
    let pieces = split(frame, size: Int(size))
    #expect(pieces == expected.map { Message.binary(hex($0.string!)) })
    var assembler = Assembler()
    #expect(try pieces.map { try assembler.take($0) }.last == frame)
}

@Test func aLongFrameGoesInPiecesAndComesBackWhole() throws {
    let frame = data(7, Data((0..<(1 << 20)).map { UInt8($0 % 251) }))
    let messages = split(frame)
    #expect(messages.count > 16)
    #expect(messages.allSatisfy { if case .binary(let d) = $0 { d.count <= piece } else { false } })
    var assembler = Assembler()
    let out = try messages.map { try assembler.take($0) }
    #expect(out.dropLast().allSatisfy { $0 == nil })
    #expect(out.last == frame)
}

@Test func aFrameThatFitsGoesWholeAndLongTextIsMeasuredInBytes() throws {
    let short = res(1, .object(["text": .string("ok")]))
    #expect(split(short) == [encode(short)])
    // 30,000 CJK characters are 90,000 bytes in UTF-8.
    let long = res(2, .object(["text": .string(String(repeating: "字", count: 30_000))]))
    let messages = split(long)
    #expect(messages.count == 2)
    var assembler = Assembler()
    #expect(try messages.map { try assembler.take($0) }.last == long)
}

@Test func aWholeFrameAmidPiecesIsAnErrorAndTheNextOneDecodes() throws {
    var assembler = Assembler()
    let first = split(data(1, Data(count: 3 * piece)))[0]
    let next = res(2, .null)
    #expect(try assembler.take(first) == nil)
    #expect(throws: FrameError.self) { try assembler.take(encode(next)) }
    #expect(try assembler.take(encode(next)) == next)
}
