// A session's conversation as its agent records it: the record found through what herdr says of the
// pane and the file Isbell's hook keeps for the session, then read from its end, more before it as
// asked, and what is added while the agent works. One read at a time. As web/src/core/chat-log.ts.

import Foundation
import IsbellKit
import Observation
import os

@MainActor
@Observable
final class ChatModel {
    enum Record: Equatable {
        /// Not known yet: the machine's records or the agent's session are still being read.
        case finding
        /// The agent keeps no record Isbell reads, or none was found for its session.
        case unrecorded
        /// There is no such file (any more), or it is too large to read.
        case unreadable
        case found(String)
    }

    private(set) var record: Record = .finding
    /// Nil until read.
    private(set) var turns: [ChatTurn]?
    /// How far into the record it is read: it grows as the agent adds to it, not as earlier turns are read.
    private(set) var end = 0
    private(set) var atStart = false
    private(set) var paging = false
    /// The last read failed; what was read before stays.
    private(set) var error: CallError?
    /// What was sent from this page, kept until the record has it.
    private(set) var sent: [Sent] = []
    /// What was sent that the record does not have yet.
    var pending: [Sent] { unrecorded(sent, turns: turns) }

    @ObservationIgnored private let mid: String
    @ObservationIgnored private let paneId: String
    @ObservationIgnored private var part: RecordPart?
    @ObservationIgnored private var queue: Task<Void, Never>?

    init(mid: String, paneId: String) {
        self.mid = mid
        self.paneId = paneId
    }

    /// Finds the record, again as the pane may run another session by now (Claude's /clear starts
    /// one), and reads it; while the agent works, or until the record is found and read, again 2 s
    /// after each read is over (10 s when the gateway reads files only whole), and once more after it
    /// settles. Returns when the calling task is cancelled.
    func follow(_ space: Space, session: Session, project: Project) async {
        guard let kind = session.kind, readsRecord(kind) else {
            record = .unrecorded
            return
        }
        let settled = session.status == .idle || session.status == .done
        // Once settled, read once more a while later, for what the agent writes as it stops.
        var oneMore = settled
        var locate = true
        repeat {
            let again = locate
            locate = false
            await inTurn { await self.refresh(space, kind: kind, session: session, project: project, locate: again) }
            if settled && read {
                guard oneMore else { return }
                oneMore = false
            }
        } while await pause(part?.whole == true ? .seconds(10) : .seconds(2))
    }

    /// Reads the turns before those read.
    func earlier(_ space: Space, kind: String) {
        guard case .found(let path) = record, !paging, !atStart else { return }
        paging = true
        Task {
            await inTurn {
                defer { self.paging = false }
                guard let part = self.part, part.start > 0 else { return }
                do throws(CallError) {
                    self.took(try await readBefore(space.open, mid: self.mid, path: path, part), kind: kind)
                } catch {
                    self.failed(error)
                }
            }
        }
    }

    /// After a reply went out: it shows at once, until the record has it.
    func didSend(_ text: String) {
        let after: SentAfter = turns.map { $0.last.map { .turn($0.id) } ?? .start } ?? .notRead
        sent = pending + [Sent(text: text, at: Int64(Date.now.timeIntervalSince1970 * 1000), after: after)]
    }

    /// What there is to know of the record is known: there is none, or it is read.
    private var read: Bool {
        switch record {
        case .finding: false
        case .unrecorded, .unreadable: true
        case .found: turns != nil
        }
    }

    // MARK: - Reading

    /// `work` after the reads before it are over.
    private func inTurn(_ work: @escaping @MainActor () async -> Void) async {
        let before = queue
        let next = Task {
            await before?.value
            await work()
        }
        queue = next
        await next.value
    }

    private func refresh(_ space: Space, kind: String, session: Session, project: Project, locate: Bool) async {
        if locate || record == .finding || record == .unrecorded,
           let found = await find(space, kind: kind, session: session, project: project), found != record
        {
            // Another record, or one to try again: read from its end.
            record = found
            part = nil
            turns = nil
            end = 0
            atStart = false
        }
        guard case .found(let path) = record else { return }
        do throws(CallError) {
            if let part, let next = try await readAfter(space.open, mid: mid, path: path, part) {
                if next.end != part.end { took(next, kind: kind) }
            } else if let last = try await readLast(space.open, mid: mid, path: path, kind: kind) {
                took(last, kind: kind)
            } else {
                record = .unreadable
                return
            }
            error = nil
        } catch where error.code == "not_found" {
            record = .unreadable
        } catch {
            failed(error)
        }
    }

    /// The record the agent in the pane keeps: as the hook's file for its session names it, else as
    /// herdr found it (pi's); nil while it cannot be told.
    private func find(_ space: Space, kind: String, session: Session, project: Project) async -> Record? {
        // Until the machine says where its records are, none can be found.
        guard let roots = space.recorded[mid] else { return nil }
        do throws(CallError) {
            let note = try await agentNote(space.call, mid: mid, paneId: paneId)
            var transcript: String?
            if let id = note.session, let key = recordKey(roots, path: project.path, cwd: session.cwd) {
                transcript = try await sessionTranscript(space, key: key, kind: kind, id: id)
            }
            error = nil
            return (transcript ?? note.file).map { .found($0) } ?? .unrecorded
        } catch {
            failed(error)
            return nil
        }
    }

    /// Nil where the hook keeps no file for the session yet, as it does only once the session is asked something.
    private func sessionTranscript(_ space: Space, key: String, kind: String, id: String) async throws(CallError) -> String? {
        do {
            let file = try await readFile(space.open, mid: mid, path: sessionFilePath(key: key, agent: kind, id: id),
                                          limit: 64 << 10)
            return file.bytes.flatMap { transcriptOf(String(decoding: $0, as: UTF8.self)) }
        } catch where error.code == "not_found" {
            return nil
        }
    }

    private func took(_ next: RecordPart, kind: String) {
        part = next
        turns = turnsOf(kind: kind, lines: next.lines)
        end = next.end
        atStart = next.start == 0
    }

    private func failed(_ error: CallError) {
        logger.warning("could not read the record of \(self.paneId): \(error.msg)")
        self.error = error
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "chat")
