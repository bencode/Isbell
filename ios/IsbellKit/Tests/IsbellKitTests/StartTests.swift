import Testing

@testable import IsbellKit

/// What a start sent, answered as a gateway does.
@MainActor
private final class Sent {
    var calls: [(mid: String, method: String, params: JSON, timeout: Duration)] = []
    var reply: JSON = .object(["name": .string("claude-1"), "paneId": .string("w1A:p2")])

    var caller: Caller {
        { [unowned self] mid, m, p, timeout async throws(CallError) in
            calls.append((mid, m, p, timeout))
            return reply
        }
    }
}

private func template(_ agent: String, _ command: String? = nil) -> StartTemplate {
    StartTemplate(name: command ?? agent, agent: agent, command: command ?? agent)
}

@MainActor
@Test func anAgentStartsInTheProjectAndLeadsToItsPane() async throws {
    let sent = Sent()
    let started = try await startTemplate(sent.caller, mid: "m1", cwd: "/Users/q/work/app", template: template("claude"))
    #expect(started == Started(name: "claude-1", paneId: "w1A:p2", recognized: true))
    #expect(sent.calls.count == 1)
    #expect(sent.calls[0].mid == "m1")
    #expect(sent.calls[0].method == "isbell.agent.start")
    #expect(sent.calls[0].params == .object(["cwd": .string("/Users/q/work/app"), "kind": .string("claude")]))
    #expect(sent.calls[0].timeout == .seconds(150))
}

@MainActor
@Test func piStartsInItsRegularMode() async throws {
    let sent = Sent()
    _ = try await startTemplate(sent.caller, mid: "m1", cwd: "/w", template: template("pi"))
    #expect(sent.calls[0].params["args"] == .array([.string("--tui-mode"), .string("regular")]))
}

@MainActor
@Test func aCommandOfItsOwnIsTypedByTheGatewayWhichMayNotSeeTheAgent() async throws {
    let sent = Sent()
    sent.reply = .object(["name": .string("codex-app"), "paneId": .string("w2:p1"), "recognized": .bool(false)])
    let started = try await startTemplate(sent.caller, mid: "m1", cwd: "/w",
                                          template: template("codex", " HTTP_PROXY=http://127.0.0.1:7890 codex "))
    #expect(started == Started(name: "codex-app", paneId: "w2:p1", recognized: false))
    #expect(sent.calls[0].method == "isbell.agent.launch")
    #expect(sent.calls[0].params == .object([
        "cwd": .string("/w"), "kind": .string("codex"), "command": .string("HTTP_PROXY=http://127.0.0.1:7890 codex"),
    ]))
}

@Test func anAgentTakesAMessageOnceUpStandingOrAsking() {
    let info = { (fields: [String: JSON]) in JSON.object(fields) }
    #expect(!readyOf(info(["agent_status": .string("idle"), "launch_pending": .bool(true), "interactive_ready": .bool(false)])))
    #expect(readyOf(info(["agent_status": .string("idle"), "launch_pending": .bool(false), "interactive_ready": .bool(true)])))
    #expect(readyOf(info(["agent_status": .string("blocked"), "launch_pending": .bool(true)])))
    #expect(readyOf(info(["agent_status": .string("idle"), "launch_pending": .bool(false), "interactive_ready": .bool(false)])))
    #expect(!readyOf(info(["agent_status": .string("working"), "launch_pending": .bool(false)])))
    #expect(!readyOf(info(["agent_status": .string("unknown")])))
    #expect(!readyOf(nil))
}

@MainActor
@Test func startingWaitsForTheAgentAndGivesUpInTime() async {
    var replies: [JSON] = [
        .object(["agent": .object(["agent_status": .string("unknown"), "launch_pending": .bool(true)])]),
        .object(["agent": .object(["agent_status": .string("idle"), "interactive_ready": .bool(true)])]),
    ]
    var asked = 0
    let ready: Caller = { _, _, _, _ async throws(CallError) in
        asked += 1
        return replies.isEmpty ? .null : replies.removeFirst()
    }
    #expect(await waitReady(ready, mid: "m1", paneId: "w1:p1", limit: .seconds(5), every: .milliseconds(1)))
    #expect(asked == 2)

    let never: Caller = { _, _, _, _ async throws(CallError) in
        throw CallError(code: "agent_not_found", msg: "gone")
    }
    #expect(!(await waitReady(never, mid: "m1", paneId: "w1:p1", limit: .milliseconds(20), every: .milliseconds(1))))
}
