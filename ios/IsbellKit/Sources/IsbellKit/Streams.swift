// A stream is a call whose result opens it; data then flows by the same id until either side ends
// it. A file read comes in as this side grants credit; a file written goes out as the far side does.

import Foundation

/// Credit window in body bytes, as isbell-proto's flow.rs sets it.
public let streamWindow = 1 << 20
/// Largest chunk body, as isbell-proto's flow.rs sets it.
public let maxChunk = 63 * 1024

public struct StreamEvents: Sendable {
    /// The body of each data frame: a file's chunk, or a terminal's screen.
    public var data: @MainActor (Data) -> Void
    /// The far side lets this side send `n` more body bytes: for a stream this side writes.
    public var credit: @MainActor (Int) -> Void
    /// Once, when the far side ends the stream or the link is lost; not after `close`.
    public var end: @MainActor (RpcError?) -> Void

    public init(data: @escaping @MainActor (Data) -> Void, credit: @escaping @MainActor (Int) -> Void = { _ in },
                end: @escaping @MainActor (RpcError?) -> Void) {
        self.data = data
        self.credit = credit
        self.end = end
    }
}

@MainActor
public final class RpcStream {
    private let id: UInt64
    /// Its machine, on the relay; nothing on a direct link.
    private let route: Route
    private weak var router: Router?
    private var unacked = 0

    init(id: UInt64, route: Route, router: Router) {
        self.id = id
        self.route = route
        self.router = router
    }

    /// Lets the far side send `n` more body bytes.
    public func grant(_ n: Int) {
        router?.streamSend(id, .credit(id: id, n: UInt64(n), route: route))
    }

    /// Counts body bytes handled; grants them back once they reach half the window.
    public func consumed(_ n: Int) {
        unacked += n
        guard unacked >= streamWindow / 2 else { return }
        grant(unacked)
        unacked = 0
    }

    /// Sends a file's chunk: no larger than `maxChunk`, within the credit granted.
    public func send(chunk body: Data) {
        router?.streamSend(id, .data(id: id, k: .chunk, full: nil, cols: nil, rows: nil, route: route), body: body)
    }

    /// Ends what this side sends; the far side's end, with its outcome, still comes.
    public func finish() {
        router?.streamSend(id, .end(id: id, e: nil, route: route))
    }

    /// Ends the stream from this side; no event comes after.
    public func close() {
        router?.streamClose(id, .end(id: id, e: nil, route: route))
    }
}
