// What herdr knows of an agent besides its screen: the title it gives its terminal, the session it
// made out, and what Isbell's hook in it (integrations/agent-hook.sh) reports as it works.
// As web/src/model/agent-note.ts.

import Foundation

public struct ToolUse: Sendable, Equatable {
    public var tool: String
    public var target: String?
}

/// A tool and what it is used on, in a line.
public func toolLine(_ use: ToolUse) -> String {
    use.target.map { "\(use.tool) \($0)" } ?? use.tool
}

public struct AgentNote: Sendable, Equatable {
    /// The task, as the agent titles its terminal; none while the title says nothing of it.
    public var title: String?
    /// What the turn going on was asked.
    public var asked: String?
    /// The tool it runs now.
    public var doing: ToolUse?
    /// The tool it asks leave to run.
    public var asking: ToolUse?
    /// Its permission mode, when not the default.
    public var mode: String?
    /// The agent's own id for the session in the pane: as its hook reported it, else as herdr made it out.
    public var session: String?
    /// The file herdr found that session kept in (pi's), for a record that does not say.
    public var file: String?
}

/// The part of herdr's agent info read.
public struct AgentInfo: Sendable, Decodable {
    public struct Found: Sendable, Decodable {
        public var agent: String?
        public var kind: String?
        public var value: String?
    }

    public var agent: String?
    public var cwd: String?
    public var terminalTitle: String?
    public var tokens: [String: String?]?
    /// The session herdr found the agent in: its id, or the file it is kept in.
    public var agentSession: Found?

    public init(agent: String? = nil, cwd: String? = nil, terminalTitle: String? = nil,
                tokens: [String: String?]? = nil, agentSession: Found? = nil) {
        self.agent = agent
        self.cwd = cwd
        self.terminalTitle = terminalTitle
        self.tokens = tokens
        self.agentSession = agentSession
    }

    enum CodingKeys: String, CodingKey {
        case agent, cwd, tokens
        case terminalTitle = "terminal_title_stripped"
        case agentSession = "agent_session"
    }
}

private func baseName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? ""
}

/// The session's id from herdr: given as is, or the last id in the name of the file it is kept in
/// (pi's `<time>_<id>.jsonl`). Only for the agent in the pane now.
private func herdrSession(_ info: AgentInfo) -> String? {
    guard let s = info.agentSession, let value = s.value, !value.isEmpty, s.agent == info.agent else { return nil }
    if s.kind == "id" { return value }
    guard s.kind == "path" else { return nil }
    let uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    return baseName(value).matches(of: uuid).last.map { String($0.output) }
}

/// The file herdr found the session of the agent in the pane now kept in.
private func herdrFile(_ info: AgentInfo) -> String? {
    guard let s = info.agentSession, s.kind == "path", let value = s.value, !value.isEmpty, s.agent == info.agent
    else { return nil }
    return value
}

/// The command that started the agent, as its terminal is titled until the agent titles it.
private func isCommand(_ title: String, agent: String) -> Bool {
    let words = title.split(whereSeparator: \.isWhitespace)
    return words.first.map(String.init) == agent && words.dropFirst().allSatisfy { $0.hasPrefix("-") }
}

/// A title naming no task: the agent's own name before it has one, the command that started it, or
/// the directory it is in, alone or after pi's mark.
private func says(_ title: String, _ info: AgentInfo) -> Bool {
    let dir = baseName(info.cwd ?? "")
    let plain = [info.agent ?? "", "Claude Code", dir, "π - \(dir)"]
    return !isCommand(title, agent: info.agent ?? "") && !plain.contains { $0.lowercased() == title.lowercased() }
}

/// The task the agent's terminal is titled with, if it names one.
public func titleOf(_ info: AgentInfo) -> String? {
    let raw = (info.terminalTitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // Codex titles its terminal "task | directory".
    let title = info.agent == "codex" ? raw.replacing(/\ \| [^|]*$/, with: "") : raw
    return !title.isEmpty && says(title, info) ? title : nil
}

private func toolUse(_ tool: String?, _ target: String?) -> ToolUse? {
    tool.map { ToolUse(tool: $0, target: target) }
}

public func noteOf(_ info: AgentInfo) -> AgentNote {
    // What an agent's hook left in a pane outlives it there, so it is read only for the agent that
    // reported it; the hook's first version, for Claude Code alone, did not say which.
    let ours = ((info.tokens?["isbell_agent"] ?? nil) ?? "claude") == info.agent
    let token = { (name: String) -> String? in
        guard ours, let value = info.tokens?[name] ?? nil, !value.isEmpty else { return nil }
        return value
    }
    let mode = token("isbell_mode")
    let session = token("isbell_session") ?? herdrSession(info)
    return AgentNote(
        title: titleOf(info),
        asked: token("isbell_ask"),
        doing: toolUse(token("isbell_tool"), token("isbell_target")),
        asking: toolUse(token("isbell_wait_tool"), token("isbell_wait_target")),
        mode: mode == "default" ? nil : mode,
        session: session,
        file: session == nil ? nil : herdrFile(info))
}
