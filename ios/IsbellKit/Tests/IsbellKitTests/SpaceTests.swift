import Testing

@testable import IsbellKit

private func state(_ id: String, boot: Int64 = 1, rev: Int64 = 1, agents: Int = 0) -> JSON {
    .object([
        "machine": .object([
            "id": .string(id), "name": .string(id), "hostname": .string("\(id).local"),
            "os": .string("macos"), "version": .string("0.6.0"),
        ]),
        "boot": .int(boot),
        "rev": .int(rev),
        "herdr": .object(["status": .string("ready")]),
        "caps": .object(["methods": .array([]), "agentKinds": .array([.string("claude")])]),
        "agents": .array((0..<agents).map { i in
            .object(["paneId": .string("p\(i)"), "status": .string("idle"), "statusSince": .int(0)])
        }),
    ])
}

private func read(_ value: JSON) -> MachineState { MachineState.read(value)! }

@Test func snapshotKeepsReadableMachinesInOrder() {
    let list = Space.from(snapshot: [
        SnapshotEntry(state: state("b"), online: true),
        SnapshotEntry(state: .object(["machine": .object([:])]), online: true),
        SnapshotEntry(state: state("a"), online: false),
    ])
    #expect(list.map(\.id) == ["b", "a"])
    #expect(list.map(\.online) == [true, false])
}

@Test func stateReplacesOnlyWhenNewer() {
    let list = Space.from(snapshot: [SnapshotEntry(state: state("a", boot: 2, rev: 5), online: false)])
    #expect(Space.applying(state: read(state("a", boot: 2, rev: 4, agents: 1)), to: list) == list)

    let newer = Space.applying(state: read(state("a", boot: 2, rev: 6, agents: 1)), to: list)
    #expect(newer.first?.state.agents.count == 1)
    #expect(newer.first?.online == false)

    let restarted = Space.applying(state: read(state("a", boot: 3, rev: 1, agents: 2)), to: list)
    #expect(restarted.first?.state.agents.count == 2)
}

@Test func stateOfANewMachineAddsItOnline() {
    let list = Space.applying(state: read(state("b")), to: Space.from(snapshot: [SnapshotEntry(state: state("a"), online: true)]))
    #expect(list.map(\.id) == ["a", "b"])
    #expect(list.last?.online == true)
}

@Test func presenceChangesOnlyKnownMachines() {
    let list = Space.from(snapshot: [SnapshotEntry(state: state("a"), online: true)])
    #expect(Space.applying(presence: "a", online: false, to: list).first?.online == false)
    #expect(Space.applying(presence: "z", online: true, to: list) == list)
}

@Test func keyIsTakenFromAPastedLinkOrText() {
    #expect(keyText(fromPasted: "https://isbell.fmap.dev/#k=isbk1-abc%2Ddef\n") == "isbk1-abc-def")
    #expect(keyText(fromPasted: "  isbk1-abc  ") == "isbk1-abc")
}
