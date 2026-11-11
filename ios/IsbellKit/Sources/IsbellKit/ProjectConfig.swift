// The directories a machine lists as its projects, in order, in a file of its own: every client
// shows the same projects. As web/src/model/project-config.ts; this client only reads it.

import Foundation
import os

public let projectsPath = "~/.isbell/projects.json"

private let version: Int64 = 1
private let fileMax = 1 << 20

/// A file that cannot be read is never written over: someone may have meant what is in it.
public enum ProjectConfig: Sendable, Equatable {
    case listed([String])
    case missing
    case broken
}

/// The directories `text` lists; nil when it is no such file, or lists anything but absolute paths,
/// which no pane's directory would ever match.
public func parseProjects(_ text: String) -> [String]? {
    let file: JSON
    do {
        file = try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
    } catch {
        return nil
    }
    guard case .int(version)? = file["version"], case .array(let entries)? = file["projects"] else { return nil }
    let paths = entries.compactMap { $0["path"]?.string }.filter { $0.hasPrefix("/") }
    return paths.count == entries.count ? paths.map(trimSlash) : nil
}

/// What machine `mid` lists as its projects, read from its file now. A gateway that takes no path
/// under `~` has no file as far as anyone can tell.
public func readProjects(_ open: Opener, mid: String) async throws(CallError) -> ProjectConfig {
    do {
        let found = try await readFile(open, mid: mid, path: projectsPath, limit: fileMax)
        if let bytes = found.bytes, let paths = parseProjects(String(decoding: bytes, as: UTF8.self)) {
            return .listed(paths)
        }
        logger.warning("the projects listed on \(mid) cannot be read")
        return .broken
    } catch where error.code == "not_found" || error.code == "bad_request" {
        return .missing
    } catch where error.code == "not_a_file" || error.code == "permission_denied" {
        logger.warning("the projects listed on \(mid) cannot be read: \(error.code)")
        return .broken
    }
}

/// The directories each machine lists, by machine id, as read or else as last kept. A machine read
/// to list nothing, or nothing readable, has none.
public func listedPaths(_ configs: [String: ProjectConfig], kept: [String: [String]]) -> [String: [String]] {
    let said = configs.compactMapValues { config -> [String]? in
        if case .listed(let paths) = config { paths } else { nil }
    }
    return kept.filter { configs[$0.key] == nil }.merging(said) { _, new in new }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "projects")
