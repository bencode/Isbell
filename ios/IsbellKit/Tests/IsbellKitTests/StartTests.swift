import Testing

@testable import IsbellKit

/// What a start sent, answered as a gateway does.
@MainActor
private final class Sent {
    var calls: [(mid: String, method: String, params: JSON, timeout: Duration)] = []

    var caller: Caller {
        { [unowned self] mid, m, p, timeout async throws(CallError) in
            calls.append((mid, m, p, timeout))
            return .object(["name": .string("claude-1"), "paneId": .string("w1A:p2")])
        }
    }
}

@MainActor
@Test func anAgentStartsInTheProjectAndLeadsToItsPane() async throws {
    let sent = Sent()
    let started = try await startAgent(sent.caller, mid: "m1", cwd: "/Users/q/work/app", kind: "claude")
    #expect(started == Started(name: "claude-1", paneId: "w1A:p2"))
    #expect(sent.calls.count == 1)
    #expect(sent.calls[0].mid == "m1")
    #expect(sent.calls[0].method == "isbell.agent.start")
    #expect(sent.calls[0].params == .object(["cwd": .string("/Users/q/work/app"), "kind": .string("claude")]))
    #expect(sent.calls[0].timeout == .seconds(150))
}

@MainActor
@Test func piStartsInItsRegularMode() async throws {
    let sent = Sent()
    _ = try await startAgent(sent.caller, mid: "m1", cwd: "/w", kind: "pi")
    #expect(sent.calls[0].params["args"] == .array([.string("--tui-mode"), .string("regular")]))
}
