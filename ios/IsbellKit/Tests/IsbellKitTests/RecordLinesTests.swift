import Foundation
import Testing

@testable import IsbellKit

// From web/src/model/chat/lines.test.ts.

@Test func aPartReadFromTheMiddleKeepsItsCutFirstLineToJoinWithThePartBefore() {
    let file = Data(#"{"n":1}\#n{"n":2}\#n{"n":3}\#n{"n":4"#.utf8)
    let later = splitLines(file.suffix(from: 12), atStart: false)
    // The line still being written is left out, and the cut one kept.
    #expect(later.lines == [.object(["n": .int(3)])])
    #expect(later.head.map { String(decoding: $0, as: UTF8.self) } == ":2}\n")
    let before = splitLines(file.prefix(12) + (later.head ?? Data()), atStart: true)
    #expect(before.lines == [.object(["n": .int(1)]), .object(["n": .int(2)])])
    #expect(before.head == nil)
    #expect(endOf(file, from: 0) == 24)
}

@Test func aPartWithNoLineEndInItIsAllTheFrontOfALine() {
    let part = splitLines(Data("abc".utf8), atStart: false)
    #expect(part.lines.isEmpty)
    #expect(part.head == Data("abc".utf8))
}
