// The herdr calls the client makes through its gateway, passed through as `herdr` calls.
// As web/src/model/herdr.ts.

import Foundation
import os

/// A call to machine `mid`: method `m` with params `p`.
public typealias Caller = @MainActor (_ mid: String, _ m: String, _ p: JSON, _ timeout: Duration)
    async throws(CallError) -> JSON

let herdrTimeout: Duration = .seconds(35)

/// A pane without an agent: a plain shell.
public struct Shell: Sendable, Equatable {
    public var mid: String
    public var paneId: String
    public var cwd: String
    public var title: String?

    public init(mid: String, paneId: String, cwd: String, title: String? = nil) {
        self.mid = mid
        self.paneId = paneId
        self.cwd = cwd
        self.title = title
    }
}

public struct Panes: Sendable, Equatable {
    public var shells: [Shell]
    /// The task of each agent's pane, by pane id, where its terminal's title names one.
    public var titles: [String: String]
}

func herdr(_ call: Caller, _ mid: String, _ method: String, _ params: JSON) async throws(CallError) -> JSON {
    try await call(mid, "herdr", .object(["method": .string(method), "params": params]), herdrTimeout)
}

private struct PaneInfo: Decodable {
    var paneId: String
    var agent: String?
    var cwd: String?
    var foregroundCwd: String?
    var terminalTitle: String?

    enum CodingKeys: String, CodingKey {
        case agent, cwd
        case paneId = "pane_id"
        case foregroundCwd = "foreground_cwd"
        case terminalTitle = "terminal_title_stripped"
    }
}

/// The panes of machine `mid`: its plain shells, and the task each agent's terminal names.
public func panes(_ call: Caller, mid: String) async throws(CallError) -> Panes {
    readPanes(try await herdr(call, mid, "session.snapshot", .object([:])), mid: mid)
}

/// What herdr's `session.snapshot` says of a machine's panes; a pane it cannot read is left out.
func readPanes(_ result: JSON, mid: String) -> Panes {
    guard case .array(let items)? = result["snapshot"]?["panes"] else { return Panes(shells: [], titles: [:]) }
    let all = items.compactMap { item -> PaneInfo? in
        do {
            return try JSONDecoder().decode(PaneInfo.self, from: Data(jsonText(item).utf8))
        } catch {
            logger.warning("ignoring an unreadable pane: \(error)")
            return nil
        }
    }
    let shells = all.compactMap { p -> Shell? in
        guard p.agent == nil, let cwd = p.foregroundCwd ?? p.cwd else { return nil }
        return Shell(mid: mid, paneId: p.paneId, cwd: cwd, title: p.terminalTitle.flatMap { $0.isEmpty ? nil : $0 })
    }
    let titles = all.compactMap { p -> (String, String)? in
        guard let agent = p.agent else { return nil }
        let info = AgentInfo(agent: agent, cwd: p.foregroundCwd ?? p.cwd, terminalTitle: p.terminalTitle)
        return titleOf(info).map { (p.paneId, $0) }
    }
    return Panes(shells: shells, titles: Dictionary(titles) { first, _ in first })
}

/// What herdr knows of the agent in pane `paneId` besides its screen.
public func agentNote(_ call: Caller, mid: String, paneId: String) async throws(CallError) -> AgentNote {
    let result = try await herdr(call, mid, "agent.get", .object(["target": .string(paneId)]))
    guard let agent = result["agent"] else { return noteOf(AgentInfo()) }
    do {
        return noteOf(try JSONDecoder().decode(AgentInfo.self, from: Data(jsonText(agent).utf8)))
    } catch {
        throw CallError(code: "bad_response", msg: "unreadable agent info: \(error)")
    }
}

/// Types `text` into the agent of pane `paneId` and submits it.
public func prompt(_ call: Caller, mid: String, paneId: String, text: String) async throws(CallError) {
    _ = try await herdr(call, mid, "agent.prompt", .object(["target": .string(paneId), "text": .string(text)]))
}

/// An agent started: what herdr calls it, and the pane it runs in.
public struct Started: Sendable, Equatable {
    public var name: String
    public var paneId: String
}

/// Starting waits for the agent to come up, which can take long on a machine slow to start it.
let startTimeout: Duration = .seconds(150)

/// Starts an agent of `kind` in `cwd` on machine `mid`. pi starts in its regular mode, which leaves the
/// conversation in the terminal's history for the chat to read. As `startIn` in
/// web/src/features/session/new-session-menu.tsx.
public func startAgent(_ call: Caller, mid: String, cwd: String, kind: String) async throws(CallError) -> Started {
    var params: [String: JSON] = ["cwd": .string(cwd), "kind": .string(kind)]
    if kind == "pi" { params["args"] = .array([.string("--tui-mode"), .string("regular")]) }
    let result = try await call(mid, "isbell.agent.start", .object(params), startTimeout)
    guard let paneId = result["paneId"]?.string else {
        throw CallError(code: "bad_response", msg: "an agent started without its pane")
    }
    return Started(name: result["name"]?.string ?? "", paneId: paneId)
}

/// Presses `keys`, as herdr names them ("esc"), in pane `paneId`.
public func sendKeys(_ call: Caller, mid: String, paneId: String, keys: [String]) async throws(CallError) {
    _ = try await herdr(call, mid, "agent.send_keys",
                        .object(["target": .string(paneId), "keys": .array(keys.map { .string($0) })]))
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "herdr")
