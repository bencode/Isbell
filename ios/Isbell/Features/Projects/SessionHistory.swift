// The sessions a project's agents had, as the hook records them on the machine: the latest, then
// month by month back as asked for, and which of them run now in a pane of the project. As
// web/src/core/session-records.ts.

import IsbellKit
import Observation
import os

@MainActor
@Observable
final class SessionHistory {
    /// The latest, the last active first; nil until first read.
    private(set) var records: [SessionRecord]?
    /// Those of the months read.
    private(set) var older: [SessionRecord] = []
    /// The months its sessions began in, the latest first, once listed; how many of them are read.
    private(set) var months: [String]?
    private(set) var read = 0
    private(set) var busy = false
    /// A place keeps as many latest as the hook does, so its months may hold more.
    private(set) var full = false
    /// The pane each running session is in, by `sessionKey`.
    private(set) var running: [String: String] = [:]
    /// The last read failed; what was read before stays.
    private(set) var error: CallError?

    /// The latest and the months read, each session once, the last active first: one resumed since its
    /// month was read is among the latest now.
    var history: [SessionRecord] {
        let recent = records ?? []
        let latest = Set(recent.map(\.key))
        return (recent + older.filter { !latest.contains($0.key) }).sorted { $0.updated > $1.updated }
    }

    /// Whether months not read yet may hold more.
    var more: Bool { full && (months.map { read < $0.count } ?? true) }

    /// Reads them again, once the machine says where its records are.
    func load(_ space: Space, project: Project) async {
        guard let roots = space.recorded[project.mid] else { return }
        do throws(CallError) {
            let recent = try await readRecent(space.open, mid: project.mid, sources: recordSources(roots, path: project.path))
            records = recent.records
            full = recent.full
            error = nil
        } catch {
            logger.warning("could not read the sessions of \(project.path): \(error.msg)")
            self.error = error
        }
        running = await runningSessions(space.call, project: project)
    }

    /// Reads months back from the latest not read: until one holds a session the latest leave out,
    /// or, with `all`, every one left, as searching needs.
    func readOlder(_ space: Space, project: Project, all: Bool) async {
        guard let records, more, !busy, let roots = space.recorded[project.mid] else { return }
        busy = true
        defer { busy = false }
        let sources = recordSources(roots, path: project.path)
        let latest = Set(records.map(\.key))
        do throws(CallError) {
            let months: [String]
            if let listed = self.months {
                months = listed
            } else {
                months = try await listMonths(space.call, mid: project.mid, sources: sources)
            }
            self.months = months
            for month in months.dropFirst(read) {
                let found = mergeMonths([try await readMonth(space.open, mid: project.mid, sources: sources, month: month)],
                                        seen: Set(older.map(\.key)))
                older += found
                read += 1
                if !all && found.contains(where: { !latest.contains($0.key) }) { break }
            }
            error = nil
        } catch {
            logger.warning("could not read the older sessions of \(project.path): \(error.msg)")
            self.error = error
        }
    }
}

/// The pane of each session the project's agents run now, by `sessionKey`; one whose agent cannot say
/// is left out.
func runningSessions(_ call: Caller, project: Project) async -> [String: String] {
    var found: [String: String] = [:]
    for s in project.sessions {
        guard let kind = s.kind, chatAgents.contains(kind) else { continue }
        do throws(CallError) {
            if let id = try await agentNote(call, mid: s.mid, paneId: s.paneId).session {
                found[sessionKey(agent: kind, id: id)] = s.paneId
            }
        } catch {
            logger.warning("cannot tell which session \(s.paneId) runs: \(error.msg)")
        }
    }
    return found
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "history")
