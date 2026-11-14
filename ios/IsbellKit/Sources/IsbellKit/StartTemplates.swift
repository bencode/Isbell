// What a machine starts an agent with, in a file of its own set by hand: each template a name, the
// agent herdr is to recognize, and the command that starts it, after which Isbell puts its own
// arguments. Without the file, a machine starts each agent by its own name. As
// web/src/model/start-templates.ts; this client only reads it.

import Foundation
import os

/// The agents Isbell is built for, as web/src/model/agents.ts: any other runs in a terminal.
public let chatAgents = ["claude", "codex", "pi"]

public let templatesPath = "~/.isbell/templates.json"
/// What a gateway serves to start an agent by a command of the user's own.
public let launchMethod = "isbell.agent.launch"

private let version: Int64 = 1
private let fileMax = 1 << 20

public struct StartTemplate: Sendable, Hashable, Decodable {
    public var name: String
    public var agent: String
    public var command: String

    public init(name: String, agent: String, command: String) {
        self.name = name
        self.agent = agent
        self.command = command
    }
}

/// What a machine's file says; one that cannot be read starts each agent by its own name.
public enum Templates: Sendable, Equatable {
    case listed([StartTemplate])
    case missing
    case broken
}

public let defaultTemplates = chatAgents.map { StartTemplate(name: $0, agent: $0, command: $0) }

/// Started as herdr starts the agent, by its own name.
public func plain(_ t: StartTemplate) -> Bool { trimmed(t.command) == t.agent }

private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

/// One a machine could start: named, of an agent Isbell knows, its command one non-empty line.
private func sound(_ t: StartTemplate) -> Bool {
    !trimmed(t.name).isEmpty && chatAgents.contains(t.agent) && !trimmed(t.command).isEmpty
        && !t.command.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
}

/// The templates `text` lists; nil when it is no such file, or any of them could not be used.
public func parseTemplates(_ text: String) -> [StartTemplate]? {
    let file: JSON
    do {
        file = try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
    } catch {
        return nil
    }
    guard case .int(version)? = file["version"], case .array(let entries)? = file["templates"] else { return nil }
    let templates = entries.compactMap { e -> StartTemplate? in
        guard let name = e["name"]?.string, let agent = e["agent"]?.string, let command = e["command"]?.string
        else { return nil }
        return StartTemplate(name: name, agent: agent, command: command)
    }
    let names = Set(templates.map { trimmed($0.name) })
    return templates.count == entries.count && templates.allSatisfy(sound) && names.count == templates.count
        ? templates : nil
}

/// What machine `mid` starts agents with, read from its file now. A gateway that takes no path under
/// `~` has no file as far as anyone can tell.
public func readTemplates(_ open: Opener, mid: String) async throws(CallError) -> Templates {
    do {
        let found = try await readFile(open, mid: mid, path: templatesPath, limit: fileMax)
        if let bytes = found.bytes, let templates = parseTemplates(String(decoding: bytes, as: UTF8.self)) {
            return .listed(templates)
        }
        logger.warning("the start templates on \(mid) cannot be read")
        return .broken
    } catch where error.code == "not_found" || error.code == "bad_request" {
        return .missing
    } catch where error.code == "not_a_file" || error.code == "permission_denied" {
        logger.warning("the start templates on \(mid) cannot be read: \(error.code)")
        return .broken
    }
}

/// The templates to offer: those listed, else, not read yet or not readable, the default ones.
public func templatesOf(_ read: Templates?) -> [StartTemplate] {
    if case .listed(let templates)? = read { templates } else { defaultTemplates }
}

/// Whether a machine can start `t`: herdr has its agent, and a command of its own needs a gateway
/// that types it.
public func usable(_ t: StartTemplate, _ caps: Caps) -> Bool {
    caps.agentKinds.contains(t.agent) && (plain(t) || caps.methods.contains(launchMethod))
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "templates")
