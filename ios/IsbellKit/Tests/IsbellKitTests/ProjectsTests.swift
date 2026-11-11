import Testing

@testable import IsbellKit

// Samples from web/src/model/projects.test.ts.

private let mid = "0123456789abcdef"

private func agent(_ paneId: String, _ cwd: String, _ status: String = "working", _ since: Int64 = 10,
                   named: Bool = true, kind: String? = nil) -> JSON {
    var fields: [String: JSON] = [
        "paneId": .string(paneId), "status": .string(status), "statusSince": .int(since), "cwd": .string(cwd),
    ]
    if named { fields["name"] = .string(paneId) }
    if let kind { fields["kind"] = .string(kind) }
    return .object(fields)
}

private func machine(_ agents: [JSON], online: Bool = true) -> MachineEntry {
    let state = MachineState.read(.object([
        "machine": .object([
            "id": .string(mid), "name": .string("mac-mini"), "hostname": .string("mac-mini.local"),
            "os": .string("macos"), "version": .string("0.1.0"),
        ]),
        "boot": .int(1),
        "rev": .int(1),
        "herdr": .object(["status": .string("ready")]),
        "caps": .object(["methods": .array([]), "agentKinds": .array([.string("codex")])]),
        "agents": .array(agents),
    ]))!
    return MachineEntry(state: state, online: online)
}

private func shell(_ paneId: String, _ cwd: String) -> Shell { Shell(mid: mid, paneId: paneId, cwd: cwd) }

private func derive(_ entries: [MachineEntry], shells: [Shell] = [], seen: Seen = [:], repos: [String: String] = [:],
                    recorded: [String: Roots] = [:], listed: [String: [String]] = [:]) -> [Project] {
    deriveProjects(entries, shells: shells, seen: seen, repos: repos, recorded: recorded, listed: listed)
}

@Test func aPaneBelongsToItsRepositoryElseItsOwnDirectory() {
    let w = "/Users/me/work"
    let repos = ["\(mid):\(w)/isbell/web": "\(w)/isbell", "\(mid):\(w)/isbell/": "\(w)/isbell"]
    let projects = derive(
        [machine([agent("p1", w), agent("p2", "\(w)/isbell/"), agent("p3", "\(w)/isbell/web")])],
        shells: [shell("s1", "\(w)/isbell/web"), shell("s2", "\(w)/notes/draft")],
        repos: repos)
    #expect(projects.map(\.display) == ["~/work/notes/draft", "~/work/isbell", "~/work"])
    #expect(projects.map { $0.sessions.map(\.paneId) } == [[], ["p2", "p3"], ["p1"]])
    #expect(projects.map { $0.shells.map(\.paneId) } == [["s2"], ["s1"], []])
}

@Test func aListedDirectoryHoldsWhatRunsInsideIt() {
    let projects = derive(
        [machine([agent("p1", "/w/app/src"), agent("p2", "/w/other")])],
        listed: [mid: ["/w/lib", "/w/app"]])
    #expect(projects.map(\.path) == ["/w/lib", "/w/app", "/w/other"])
    #expect(projects.map(\.configured) == [true, true, false])
    #expect(projects[1].sessions.map(\.paneId) == ["p1"])
}

@Test func anUnnamedAgentIsCalledByItsKindAndPane() {
    let projects = derive([machine([agent("w2:p1", "/srv/a"), agent("w1A:p1", "/srv/a", named: false, kind: "codex")])])
    let sessions = projects.first?.sessions ?? []
    #expect(sessions.map(\.name) == ["w2:p1", "codex · 1A"])
    #expect(sessions.map(\.herdrName) == ["w2:p1", nil])
}

@Test func aFinishedSessionIsUnreadUntilLookedAt() {
    let entry = machine([agent("p1", "/srv/a", "done", 50)])
    #expect(derive([entry]).first?.sessions.first?.unread == true)
    #expect(derive([entry], seen: ["\(mid)/p1": 50]).first?.sessions.first?.unread == false)
}

@Test func recordedSessionsAreProjectsAfterThoseWithPanes() {
    let recorded = [mid: [
        "/srv/old": RootInfo(key: "srv-old-1", updated: 1),
        "/srv/b": RootInfo(key: "srv-b-1", updated: 5),
        "/srv/new": RootInfo(key: "srv-new-1", updated: 9),
    ]]
    let projects = derive([machine([agent("p1", "/srv/b"), agent("p2", "/srv/z")])], recorded: recorded)
    #expect(projects.map(\.path) == ["/srv/b", "/srv/z", "/srv/new", "/srv/old"])
    #expect(projects.map(\.sessions.count) == [1, 1, 0, 0])
    #expect(projects.map(\.updated) == [5, nil, 9, 1])
}

private func ids(_ lane: [Placed]) -> [String] { lane.map(\.session.paneId) }

@Test func lanesHoldWhoAsksWhoFinishedUnseenAndWhoWorks() {
    let projects = derive(
        [machine([
            agent("asks-late", "/srv/a", "blocked", 5),
            agent("asks-early", "/srv/b", "blocked", 2),
            agent("done", "/srv/c", "done", 3),
            agent("seen", "/srv/c", "done", 1),
            agent("works", "/srv/d", "working", 4),
            agent("idle", "/srv/d", "idle", 6),
            agent("unknown", "/srv/d", "unknown", 7),
        ])],
        shells: [shell("shell", "/srv/a")],
        seen: ["\(mid)/seen": 1])
    let found = lanes(projects)
    #expect(ids(found.asking) == ["asks-early", "asks-late"])
    #expect(ids(found.finished) == ["done"])
    #expect(ids(found.running) == ["works"])
    #expect(ids(found.standing) == ["unknown", "idle", "seen"])
}

@Test func anOfflineMachineHasNoAgentInTheLanes() {
    let projects = derive([machine([agent("works", "/srv/a"), agent("asks", "/srv/b", "blocked", 2)], online: false)])
    #expect(lanes(projects) == Lanes(asking: [], finished: [], running: [], standing: []))
}

@Test func aSessionIsPlacedByItsProjectMachineAndKind() {
    let projects = derive([machine([agent("p1", "/Users/me/w/app", kind: "claude")])], listed: [mid: ["/Users/me/w/app"]])
    let placed = lanes(projects).running[0]
    #expect(placedWhere(placed) == "app · mac-mini · claude")
    #expect(placedTitle(placed) == "p1")
}
