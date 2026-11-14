import Foundation
import Testing

@testable import IsbellKit

private let session: [String: JSON] = [
    "agent": .string("claude"), "id": .string("s1"), "cwd": .string("/srv/a"), "first": .string("fix it"),
    "last": .string("and test"), "started": .int(1), "updated": .int(3),
]

private func text(_ value: JSON) -> String { jsonText(value) }

private func record(_ id: String, last: String = "x", updated: Int64) -> SessionRecord {
    SessionRecord(agent: "claude", id: id, cwd: "/srv/a", first: "fix it", last: last, started: 1, updated: updated)
}

@Test func recordsOfAnotherShapeOrHalfWrittenArePassedOver() {
    var launched = session
    launched["launch"] = .string("cc_glm && claude")
    var noLast = session
    noLast["id"] = .string("s2")
    noLast["last"] = nil
    var badLaunch = session
    badLaunch["id"] = .string("s3")
    badLaunch["launch"] = .int(3)
    let read = parseRecent(text(.array([.object(launched), .object(noLast), .object(badLaunch)])))
    #expect(read == [SessionRecord(agent: "claude", id: "s1", cwd: "/srv/a", first: "fix it", last: "and test",
                                   started: 1, updated: 3, launch: "cc_glm && claude")])
    #expect(parseRecent("{}").isEmpty)
    #expect(parseRecent("[{\"agent\": \"claude\", \"id\"").isEmpty)
}

@Test func whatWasAskedIsReadWithoutTheMarksAroundPastedTextEvenCutShort() {
    #expect(withoutPasteMarks("<pasted_content id=\"96b1\"> add a batch action </pasted_content id=\"96b1\">")
        == "add a batch action")
    #expect(withoutPasteMarks("<pasted_content id=\"96b1\"> see the logs and </pasted_conte") == "see the logs and")
    #expect(withoutPasteMarks("is a < b true") == "is a < b true")
}

@Test func claudeCodexAndPiResumeASessionByItsIdOtherAgentsAreNotResumed() {
    #expect(resumeArgs(agent: "claude", id: "id1") == ["--resume", "id1"])
    #expect(resumeArgs(agent: "codex", id: "id1") == ["resume", "id1"])
    #expect(resumeArgs(agent: "pi", id: "id1") == ["--tui-mode", "regular", "--session", "id1"])
    #expect(resumeArgs(agent: "gemini", id: "id1") == nil)
}

@Test func aSessionKeptOutsideItsAgentsOwnPlaceMayNotResumeUnlessItsCommandIsKnown() {
    var r = record("s1", updated: 1)
    #expect(!keptElsewhere(r))
    r.transcript = "/Users/u/.claude/projects/-srv-a/s1.jsonl"
    #expect(!keptElsewhere(r))
    r.transcript = "/Users/u/.rec/claude/accounts/1/config/projects/-srv-a/s1.jsonl"
    #expect(keptElsewhere(r))
    r.launch = "reclaude"
    #expect(!keptElsewhere(r))
}

@Test func aProjectsRecordsAreItsOwnBelowItAndItsRepositorysThatRanInIt() {
    let roots: Roots = [
        "/w/app": RootInfo(key: "app", updated: 1), "/w/app/tools": RootInfo(key: "tools", updated: 1),
        "/w/apple": RootInfo(key: "apple", updated: 1), "/w": RootInfo(key: "w", updated: 1),
    ]
    #expect(recordSources(roots, path: "/w/app") == [
        RecordSource(key: "w", only: "/w/app"), RecordSource(key: "app"), RecordSource(key: "tools"),
    ])
    let above = RecordSource(key: "w", only: "/w/app")
    #expect(within(above, cwd: "/w/app/web"))
    #expect(!within(above, cwd: "/w/apple"))
    #expect(within(RecordSource(key: "app"), cwd: "/x"))
}

@Test func sessionsFromSeveralPlacesAreOneListEachOnceAsLastUpdated() {
    let merged = mergeRecent([[record("s1", last: "a", updated: 5), record("s2", last: "b", updated: 7)],
                              [record("s1", last: "older", updated: 3)]])
    #expect(merged.map { [$0.id, $0.last] } == [["s2", "b"], ["s1", "a"]])
}

@Test func sessionsAreGroupedByTheLocalDayInTheOrderGiven() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    let at = { (d: Int, h: Int) in
        Int64(calendar.date(from: DateComponents(year: 2026, month: 11, day: d, hour: h))!.timeIntervalSince1970 * 1000)
    }
    let times = [at(7, 18), at(7, 9), at(6, 23), at(5, 1)]
    #expect(byDay(times, at: { $0 }, calendar: calendar).map(\.count) == [2, 1, 1])
}

@Test func aMonthsSessionsAreReadLineByLineTheLatestFirst() {
    let line = { (id: String, started: Int64, launch: JSON?) -> String in
        var e: [String: JSON] = ["agent": .string("claude"), "id": .string(id), "cwd": .string("/srv/a"),
                                 "first": .string("fix it"), "started": .int(started)]
        e["launch"] = launch
        return text(.object(e))
    }
    let read = parseMonth([line("s1", 1, nil), "{\"agent\": \"codex\", \"id\"", line("s2", 5, .string("reclaude")),
                           line("s3", 9, .int(3))].joined(separator: "\n") + "\n")
    #expect(read.map(\.id) == ["s2", "s1"])
    #expect(read[0].launch == "reclaude")
    #expect(read[0].updated == 5 && read[0].last.isEmpty)
}

@Test func monthsLinesAreOneListEachOnceLeavingOutThoseSeen() {
    let begun = { (id: String, started: Int64) in
        SessionRecord(agent: "claude", id: id, cwd: "/srv/a", first: "x", last: "", started: started, updated: started)
    }
    let merged = mergeMonths([[begun("s1", 1), begun("s3", 9)], [begun("s1", 1), begun("s2", 5)]], seen: ["claude/s3"])
    #expect(merged.map(\.id) == ["s2", "s1"])
}

@Test func aSessionIsFoundByWhatItWasAskedOrWhereItRanAndShownFromJustBefore() {
    let s = SessionRecord(agent: "claude", id: "s1", cwd: "/srv/storefront", first: "Fix the Checkout", last: "and test",
                          started: 1, updated: 2)
    #expect(matches(s, "checkout"))
    #expect(matches(s, "storefront"))
    #expect(!matches(s, "payments"))
    #expect(excerpt("short one", "one") == "short one")
    #expect(excerpt("a long line that ends with the checkout", "checkout") == "… with the checkout")
}
