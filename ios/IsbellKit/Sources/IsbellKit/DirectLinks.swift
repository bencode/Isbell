// Each machine's direct link, as Space uses it: set up on demand, shared by the calls and streams
// that come while it opens, and left alone for a while after it fails. As the direct-link part of
// web/src/model/space.ts.

import Foundation
import os

/// After a direct link fails, streams and calls to that machine use the relay this long before trying again.
private let directRetry: Duration = .seconds(5 * 60)

@MainActor
final class DirectLinks {
    private let openDirect: DirectOpener?
    private let relay: Caller
    private let directable: @MainActor (String) -> Bool
    // Per machine: the attempt at a link, being opened or open (gone once it failed), the open link,
    // and when the last attempt failed. An attempt's id tells it from one made after a reset.
    private var links: [String: (id: Int, task: Task<DirectLink?, Never>)] = [:]
    private var nextAttempt = 0
    private var direct: [String: DirectLink] = [:]
    private var failures: [String: ContinuousClock.Instant] = [:]

    /// `relay` signals a link through the relay; `directable` says whether a machine can have one.
    init(open: DirectOpener?, relay: @escaping Caller, directable: @escaping @MainActor (String) -> Bool) {
        openDirect = open
        self.relay = relay
        self.directable = directable
    }

    /// The link calls to `mid` take: an open one that takes pieces, since without them an answer too
    /// long for one message would end it.
    func callLink(_ mid: String) -> DirectLink? {
        direct[mid].flatMap { $0.pieces ? $0 : nil }
    }

    /// Machine `mid`'s direct link, open or being opened, else a new attempt at one; nil when there
    /// is none to have.
    func to(_ mid: String) -> Task<DirectLink?, Never>? {
        if let known = links[mid] { return known.task }
        guard let openDirect, worthTrying(mid) else { return nil }
        let relay = relay
        let id = nextAttempt
        nextAttempt += 1
        let task = Task { [weak self] () -> DirectLink? in
            let link: DirectLink?
            do throws(CallError) {
                link = try await openDirect(relay, mid)
            } catch {
                logger.warning("no direct link to \(mid); streams and calls use the relay: \(error.msg)")
                link = nil
            }
            guard let self else {
                link?.close()
                return nil
            }
            return took(link, for: mid, attempt: id)
        }
        links[mid] = (id, task)
        return task
    }

    func status(_ mid: String) -> DirectStatus {
        if let link = direct[mid] { return .open(link.path) }
        if links[mid] != nil { return .opening }
        if let at = recentFailure(mid) { return .failed(retryIn: at + directRetry - ContinuousClock.now) }
        return openDirect != nil && directable(mid) ? .none : .unsupported
    }

    func stats(_ mid: String) async -> LinkStats? { await direct[mid]?.stats() }

    /// Closes machine `mid`'s open link, as its machine restarted or went offline. Its onClosed drops
    /// it only later, and calls made meanwhile must not go to the closed link.
    func drop(_ mid: String) {
        direct.removeValue(forKey: mid)?.close()
    }

    /// Closes every link and forgets their failures: the next call sets one up again.
    func reset() {
        closeAll()
        failures = [:]
    }

    func closeAll() {
        direct.values.forEach { $0.close() }
        direct = [:]
        links = [:]
    }

    private func worthTrying(_ mid: String) -> Bool {
        directable(mid) && recentFailure(mid) == nil
    }

    /// The last failure, while it still keeps streams and calls on the relay.
    private func recentFailure(_ mid: String) -> ContinuousClock.Instant? {
        failures[mid].flatMap { ContinuousClock.now - $0 < directRetry ? $0 : nil }
    }

    /// Keeps what attempt `id` opened, unless a reset or a close came first.
    private func took(_ link: DirectLink?, for mid: String, attempt id: Int) -> DirectLink? {
        guard links[mid]?.id == id else {
            link?.close()
            return nil
        }
        guard let link else {
            links[mid] = nil
            failures[mid] = .now
            return nil
        }
        direct[mid] = link
        link.onClosed = { [weak self, weak link] in
            guard let self else { return }
            if let link, direct[mid] === link { direct[mid] = nil }
            if links[mid]?.id == id { links[mid] = nil }
        }
        return link
    }
}

/// What `opening` gives, or nil once `limit` passes first; the attempt goes on either way.
@MainActor
func within(_ limit: Duration, _ opening: Task<DirectLink?, Never>) async -> DirectLink? {
    let race = Race()
    return await withCheckedContinuation { continuation in
        race.continuation = continuation
        Task { race.settle(await opening.value) }
        Task { if await pause(limit) { race.settle(nil) } }
    }
}

/// Resumes its continuation with whichever value comes first.
@MainActor
private final class Race {
    var continuation: CheckedContinuation<DirectLink?, Never>?

    func settle(_ value: DirectLink?) {
        continuation?.resume(returning: value)
        continuation = nil
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "direct")
