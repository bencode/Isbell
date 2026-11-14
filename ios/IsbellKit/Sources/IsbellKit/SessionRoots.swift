// Every project a machine's agents have had a session in, as Isbell's agent hook
// (integrations/agent-hook.sh) records them in ~/.isbell/sessions/roots.json, and the file it keeps
// for each session there, which names the agent's own record of it. As the roots part of
// web/src/model/sessions.ts.

import Foundation
import os

let store = "~/.isbell/sessions"
public let rootsPath = "\(store)/roots.json"

/// Where a project's records are, and when one of them last changed.
public struct RootInfo: Sendable, Equatable {
    public var key: String
    /// Milliseconds since the epoch.
    public var updated: Int64
}

/// By the project's root.
public typealias Roots = [String: RootInfo]

/// Text that may not be JSON, as a file the hook writes can be cut short by a full disk.
public func parseRoots(_ text: String) -> Roots {
    let found: JSON
    do {
        found = try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
    } catch {
        logger.warning("ignoring an unreadable session record: \(error)")
        return [:]
    }
    guard case .object(let fields) = found else { return [:] }
    return fields.compactMapValues { value -> RootInfo? in
        guard let key = value["key"]?.string, !key.isEmpty, let updated = time(value["updated"]) else { return nil }
        return RootInfo(key: key, updated: updated)
    }
    .filter { $0.key.hasPrefix("/") }
}

/// The key of the records of the project at `path`, else of the directory `cwd`, as the hook files a
/// session under the repository it ran in, or the directory itself.
public func recordKey(_ roots: Roots, path: String, cwd: String?) -> String? {
    roots[path]?.key ?? cwd.flatMap { roots[$0]?.key }
}

/// The file the hook keeps for a session once it is asked something.
public func sessionFilePath(key: String, agent: String, id: String) -> String {
    "\(store)/\(key)/sessions/\(agent)-\(id).json"
}

/// Where the agent keeps the conversation, as the session's file names it (hook v5 on); nil for a
/// file that does not say, or cannot be read.
public func transcriptOf(_ text: String) -> String? {
    do {
        let found = try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
        return found["transcript"]?.string.flatMap { $0.hasPrefix("/") ? $0 : nil }
    } catch {
        logger.warning("ignoring an unreadable session file: \(error)")
        return nil
    }
}

func time(_ value: JSON?) -> Int64? {
    switch value {
    case .int(let n)?: n
    case .double(let n)? where n.isFinite: Int64(n)
    default: nil
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "sessions")
