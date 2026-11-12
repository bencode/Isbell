// The sessions a project's agents had, as Isbell's agent hook (integrations/agent-hook.sh) records
// them under the machine's ~/.isbell/sessions: each project's latest, from which one is resumed in a
// new pane in the directory it ran in. As the recent part of web/src/model/sessions.ts.

import Foundation
import os

/// A session as last recorded; times in milliseconds since the epoch.
public struct SessionRecord: Sendable, Hashable {
    public var agent: String
    public var id: String
    public var cwd: String
    /// What it was first and last asked.
    public var first: String
    public var last: String
    public var started: Int64
    public var updated: Int64
    /// The file the agent keeps the conversation in, once the hook (v5) has told it.
    public var transcript: String?
    /// The command it was started with, where that was a template's own (hook v6), which resumes it.
    public var launch: String?

    public init(agent: String, id: String, cwd: String, first: String, last: String, started: Int64,
                updated: Int64, transcript: String? = nil, launch: String? = nil)
    {
        self.agent = agent
        self.id = id
        self.cwd = cwd
        self.first = first
        self.last = last
        self.started = started
        self.updated = updated
        self.transcript = transcript
        self.launch = launch
    }

    /// What names it among every agent's sessions.
    public var key: String { sessionKey(agent: agent, id: id) }
}

/// The project's latest sessions, the last active first.
public func recentPath(_ key: String) -> String { "\(store)/\(key)/recent.json" }

public func sessionKey(agent: String, id: String) -> String { "\(agent)/\(id)" }

/// The records `text` holds; one of another shape is passed over, as is text the hook left half
/// written.
public func parseRecent(_ text: String) -> [SessionRecord] {
    let found: JSON
    do {
        found = try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
    } catch {
        logger.warning("ignoring unreadable recent sessions: \(error)")
        return []
    }
    guard case .array(let entries) = found else { return [] }
    return entries.compactMap(recordOf)
}

private func recordOf(_ e: JSON) -> SessionRecord? {
    guard let agent = e["agent"]?.string, let id = e["id"]?.string, let cwd = e["cwd"]?.string,
          let first = e["first"]?.string, let last = e["last"]?.string,
          let started = time(e["started"]), let updated = time(e["updated"]),
          optionalText(e["transcript"]), optionalText(e["launch"])
    else { return nil }
    return SessionRecord(agent: agent, id: id, cwd: cwd, first: withoutPasteMarks(first),
                         last: withoutPasteMarks(last), started: started, updated: updated,
                         transcript: e["transcript"]?.string, launch: e["launch"]?.string)
}

/// Absent, or text.
private func optionalText(_ value: JSON?) -> Bool { value == nil || value?.string != nil }

private let opened = "<pasted_content id=\""
private let closed = "</pasted_content id=\""

/// What was said, without the marks wrapped around pasted text. The hook keeps the first 200
/// characters, which can cut the closing mark short.
func withoutPasteMarks(_ text: String) -> String {
    guard text.contains(opened) else { return text }
    let clean = text.replacing(#/\s*<\/?pasted_content id="[^"]*">\s*/#, with: " ")
    let cut = clean.lastIndex(of: "<").flatMap { at -> String.Index? in
        let tail = String(clean[at...])
        return closed.hasPrefix(tail) || (tail.hasPrefix(closed) && !tail.contains(">")) ? at : nil
    }
    return String(clean[..<(cut ?? clean.endIndex)]).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Where some of a project's records are kept; `only`: of them, those that ran under it, as the
/// project is a directory inside the repository they are recorded for.
public struct RecordSource: Sendable, Equatable {
    public var key: String
    public var only: String?

    public init(key: String, only: String? = nil) {
        self.key = key
        self.only = only
    }
}

/// Whether `dir` is `top` or below it.
func under(_ dir: String, _ top: String) -> Bool { dir == top || dir.hasPrefix("\(top)/") }

/// The roots recorded where a project's sessions may be: itself and below it, and a repository it is
/// inside of. The hook files a worktree's sessions under its main checkout, the project itself.
public func recordSources(_ roots: Roots, path: String) -> [RecordSource] {
    roots.sorted { $0.key < $1.key }.compactMap { root, info in
        if under(root, path) { return RecordSource(key: info.key) }
        return under(path, root) ? RecordSource(key: info.key, only: path) : nil
    }
}

/// Whether a session the source holds belongs to the project.
public func within(_ source: RecordSource, cwd: String) -> Bool {
    source.only.map { under(cwd, $0) } ?? true
}

/// The lists as one, each session once as it was last updated, the last active first.
public func mergeRecent(_ lists: [[SessionRecord]]) -> [SessionRecord] {
    let latest = lists.joined().reduce(into: [String: SessionRecord]()) { latest, s in
        if latest[s.key].map({ $0.updated < s.updated }) ?? true { latest[s.key] = s }
    }
    return latest.values.sorted { $0.updated > $1.updated }
}

/// How the agent resumes session `id`, after its own command; nil for an agent Isbell cannot. pi,
/// resumed into the chat, runs in its regular mode, which leaves the conversation for it to read.
public func resumeArgs(agent: String, id: String) -> [String]? {
    switch agent {
    case "claude": ["--resume", id]
    case "codex": ["resume", id]
    case "pi": ["--tui-mode", "regular", "--session", id]
    default: nil
    }
}

/// The items in the order given, in runs of one local day.
public func byDay<T>(_ items: [T], at: (T) -> Int64, calendar: Calendar = .current) -> [[T]] {
    func date(_ item: T) -> Date { Date(timeIntervalSince1970: Double(at(item)) / 1000) }
    return items.reduce(into: [[T]]()) { days, item in
        if let first = days.last?.first, calendar.isDate(date(first), inSameDayAs: date(item)) {
            days[days.count - 1].append(item)
        } else {
            days.append([item])
        }
    }
}

private let recentMax = 4 << 20

/// The latest sessions of a project, from each place they are kept for it; a place with none yet
/// has no file.
@MainActor
public func readRecent(_ open: Opener, mid: String, sources: [RecordSource]) async throws(CallError) -> [SessionRecord] {
    var lists: [[SessionRecord]] = []
    for source in sources {
        do {
            let file = try await readFile(open, mid: mid, path: recentPath(source.key), limit: recentMax)
            guard let bytes = file.bytes else {
                logger.warning("the recent sessions of \(source.key) are too large to read")
                continue
            }
            lists.append(parseRecent(String(decoding: bytes, as: UTF8.self)).filter { within(source, cwd: $0.cwd) })
        } catch where error.code == "not_found" {
            continue
        }
    }
    return mergeRecent(lists)
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "sessions")
