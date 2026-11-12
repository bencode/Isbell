// The sessions a project's agents had: the latest, as the hook records them on the machine, and which
// of them run now in a pane of the project. As web/src/core/session-records.ts, the latest only.

import IsbellKit
import Observation
import os

@MainActor
@Observable
final class SessionHistory {
    /// The last active first; nil until first read.
    private(set) var records: [SessionRecord]?
    /// The pane each running session is in, by `sessionKey`.
    private(set) var running: [String: String] = [:]
    /// The last read failed; what was read before stays.
    private(set) var error: CallError?

    /// Reads them again, once the machine says where its records are.
    func load(_ space: Space, project: Project) async {
        guard let roots = space.recorded[project.mid] else { return }
        do throws(CallError) {
            records = try await readRecent(space.open, mid: project.mid, sources: recordSources(roots, path: project.path))
            error = nil
        } catch {
            logger.warning("could not read the sessions of \(project.path): \(error.msg)")
            self.error = error
        }
        running = await runningSessions(space.call, project: project)
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
