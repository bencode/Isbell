// The sessions a project's agents had, as Isbell's agent hook (integrations/agent-hook.sh) records
// them under the machine's ~/.isbell/sessions: each project's latest, and every one by the month it
// began, from which one is resumed in a new pane in the directory it ran in. As
// web/src/model/sessions.ts.

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
    /// Where it is kept: the key of its records, once read from them.
    public var source: String?

    public init(agent: String, id: String, cwd: String, first: String, last: String, started: Int64,
                updated: Int64, transcript: String? = nil, launch: String? = nil, source: String? = nil)
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
        self.source = source
    }

    /// What names it among every agent's sessions.
    public var key: String { sessionKey(agent: agent, id: id) }
}

/// The project's latest sessions, the last active first.
public func recentPath(_ key: String) -> String { "\(store)/\(key)/recent.json" }
public func monthsDir(_ key: String) -> String { "\(store)/\(key)/months" }
/// `month` as the file is named: YYYY-MM.
public func monthPath(_ key: String, _ month: String) -> String { "\(monthsDir(key))/\(month).jsonl" }

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

/// The sessions begun in a month, the latest first: as each began, what it was first asked, and as
/// last active, when it began. A line cut short, or of another shape, is passed over.
public func parseMonth(_ text: String) -> [SessionRecord] {
    let decoder = JSONDecoder()
    return text.split(whereSeparator: \.isNewline).compactMap { line -> SessionRecord? in
        do {
            return lineOf(try decoder.decode(JSON.self, from: Data(line.utf8)))
        } catch {
            logger.warning("ignoring an unreadable month's line: \(error)")
            return nil
        }
    }
    .sorted { $0.started > $1.started }
}

/// A session as its month's line has it.
private func lineOf(_ e: JSON) -> SessionRecord? {
    guard let agent = e["agent"]?.string, let id = e["id"]?.string, let cwd = e["cwd"]?.string,
          let first = e["first"]?.string, let started = time(e["started"]), optionalText(e["launch"])
    else { return nil }
    return SessionRecord(agent: agent, id: id, cwd: cwd, first: withoutPasteMarks(first), last: "",
                         started: started, updated: started, launch: e["launch"]?.string)
}

/// A session as the latest have it: its line, and what it was last asked, when, and where it is kept.
private func recordOf(_ e: JSON) -> SessionRecord? {
    guard var s = lineOf(e), let last = e["last"]?.string, let updated = time(e["updated"]),
          optionalText(e["transcript"])
    else { return nil }
    s.last = withoutPasteMarks(last)
    s.updated = updated
    s.transcript = e["transcript"]?.string
    return s
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

/// Months' lines as one, each session once, leaving out those `seen`, the latest begun first.
public func mergeMonths(_ lists: [[SessionRecord]], seen: Set<String>) -> [SessionRecord] {
    var kept = Set(seen)
    return lists.joined().filter { kept.insert($0.key).inserted }.sorted { $0.started > $1.started }
}

/// Whether what the session was asked, or where it ran, holds `needle` (lower case).
public func matches(_ s: SessionRecord, _ needle: String) -> Bool {
    [s.first, s.last, s.cwd].contains { $0.lowercased().contains(needle) }
}

private let beforeMatch = 10

/// `text` from just before `needle` (lower case), so that a row as wide as it is shows the match.
public func excerpt(_ text: String, _ needle: String) -> String {
    guard let at = text.range(of: needle, options: .caseInsensitive)?.lowerBound else { return text }
    let offset = text.distance(from: text.startIndex, to: at)
    return offset <= beforeMatch ? text : "…" + text.dropFirst(offset - beforeMatch)
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

/// Where each agent keeps its sessions unless told otherwise.
private let ownSessions = ["claude": "/.claude/projects/", "codex": "/.codex/sessions/", "pi": "/.pi/agent/sessions/"]

/// Started outside Isbell with the agent keeping its sessions elsewhere (another config dir, as a
/// wrapper like `rec` sets): resumed by the agent's plain command, it may not find the session.
public func keptElsewhere(_ record: SessionRecord) -> Bool {
    guard record.launch == nil, let transcript = record.transcript, let own = ownSessions[record.agent] else { return false }
    return !transcript.contains(own)
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

private let readMax = 4 << 20
/// As the gateway lists a directory for the files view.
private let listTimeout: Duration = .seconds(20)
/// As many latest as the hook keeps for a project (RECENT_MAX in integrations/agent-hook.sh).
private let recentMax = 50

/// A project's latest sessions, and whether a place keeps as many as it does, when its months may
/// hold more.
public struct Recent: Sendable, Equatable {
    public var records: [SessionRecord]
    public var full: Bool
}

/// The latest sessions of a project, from each place they are kept for it; a place with none yet
/// has no file.
@MainActor
public func readRecent(_ open: Opener, mid: String, sources: [RecordSource]) async throws(CallError) -> Recent {
    var lists: [[SessionRecord]] = []
    var full = false
    for source in sources {
        guard let text = try await readRecords(open, mid: mid, path: recentPath(source.key)) else { continue }
        let list = parseRecent(text)
        full = full || list.count >= recentMax
        lists.append(kept(list, by: source))
    }
    return Recent(records: mergeRecent(lists), full: full)
}

/// The months a project's sessions began in, the latest first.
@MainActor
public func listMonths(_ call: Caller, mid: String, sources: [RecordSource]) async throws(CallError) -> [String] {
    var months = Set<String>()
    for source in sources {
        do throws(CallError) {
            let listing = try await call(mid, "isbell.file.list", .object(["path": .string(monthsDir(source.key))]), listTimeout)
            guard case .array(let entries)? = listing["entries"] else {
                throw CallError(code: "bad_response", msg: "a listing without its entries")
            }
            months.formUnion(entries.compactMap { $0["name"]?.string.flatMap(monthOf) })
        } catch where error.code == "not_found" {
            continue
        }
    }
    return months.sorted(by: >)
}

/// The sessions of a project begun in `month`, the latest first.
@MainActor
public func readMonth(_ open: Opener, mid: String, sources: [RecordSource], month: String) async throws(CallError) -> [SessionRecord] {
    var lists: [[SessionRecord]] = []
    for source in sources {
        guard let text = try await readRecords(open, mid: mid, path: monthPath(source.key, month)) else { continue }
        lists.append(kept(parseMonth(text), by: source))
    }
    return mergeMonths(lists, seen: [])
}

/// YYYY-MM, of a month's file name.
private func monthOf(_ name: String) -> String? {
    name.wholeMatch(of: #/(\d{4}-\d{2})\.jsonl/#).map { String($0.1) }
}

/// Those of the project, as kept by `source`.
private func kept(_ list: [SessionRecord], by source: RecordSource) -> [SessionRecord] {
    list.filter { within(source, cwd: $0.cwd) }.map { s in
        var s = s
        s.source = source.key
        return s
    }
}

/// A file of records; nil where there is none yet, or it is too large to read.
@MainActor
private func readRecords(_ open: Opener, mid: String, path: String) async throws(CallError) -> String? {
    do {
        let file = try await readFile(open, mid: mid, path: path, limit: readMax)
        guard let bytes = file.bytes else {
            logger.warning("\(path) is too large to read")
            return nil
        }
        return String(decoding: bytes, as: UTF8.self)
    } catch where error.code == "not_found" {
        return nil
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "sessions")
