// Calls and streams over one link, matched by id: the relay connection and a direct link each have
// one. As web/src/model/streams.ts `createRouter`.

import Foundation

@MainActor
public final class Router {
    private struct Pending {
        let mid: String
        let continuation: CheckedContinuation<JSON, any Error>
        let timer: Task<Void, Never>
    }

    private struct Open {
        let mid: String
        let events: StreamEvents
    }

    private let routed: Bool
    private let send: @MainActor (Frame) -> Void
    private var pending: [UInt64: Pending] = [:]
    private var streams: [UInt64: Open] = [:]
    private var nextId: UInt64 = 1

    /// `routed`: frames to the relay name their machine in `mid`; frames on a direct link must not.
    init(routed: Bool, send: @escaping @MainActor (Frame) -> Void) {
        self.routed = routed
        self.send = send
    }

    /// Resolves with the result, or throws a CallError.
    func call(_ mid: String, _ m: String, _ p: JSON, timeout: Duration) async throws(CallError) -> JSON {
        let id = nextId
        nextId += 1
        return try await request(id, mid, m, p, timeout)
    }

    /// Opens a stream: a call whose result starts it. Registered before the call goes out, so data
    /// right behind the result is not lost.
    func open(_ mid: String, _ m: String, _ p: JSON, timeout: Duration, events: StreamEvents)
        async throws(CallError) -> (result: JSON, stream: RpcStream)
    {
        let id = nextId
        nextId += 1
        streams[id] = Open(mid: mid, events: events)
        let result = try await request(id, mid, m, p, timeout)
        return (result, RpcStream(id: id, route: route(mid), router: self))
    }

    /// Hands a res, data or end frame to its call or stream; anything else is ignored.
    func handle(_ frame: Frame) {
        switch frame.header {
        case .res(let id, let ok, let r, let e, _):
            settle(id, ok ? .success(r ?? .null) : .failure(CallError(code: e?.code ?? "error", msg: e?.msg ?? "the call failed")))
        // A terminal's frames carry its screen, and the pane's size; a file's chunks are bytes alone.
        case .data(let id, .frame, _, let cols, let rows, _):
            let size: TermSize? = if let cols, let rows, cols > 0, rows > 0 { TermSize(cols: Int(cols), rows: Int(rows)) } else { nil }
            streams[id]?.events.frame(frame.body ?? Data(), size)
        case .data(let id, .chunk, _, _, _, _):
            streams[id]?.events.data(frame.body ?? Data())
        case .end(let id, let e, _):
            streams.removeValue(forKey: id)?.events.end(e)
        case .credit(let id, let n, _):
            streams[id]?.events.credit(Int(n))
        default:
            break
        }
    }

    /// Fails the pending calls and ends the open streams whose machine matches.
    func fail(code: String, msg: String, where match: (String) -> Bool) {
        let ids = pending.filter { match($0.value.mid) }.map(\.key)
        ids.forEach { settle($0, .failure(CallError(code: code, msg: msg))) }
        let ended = streams.filter { match($0.value.mid) }
        ended.keys.forEach { streams.removeValue(forKey: $0) }
        ended.values.forEach { $0.events.end(RpcError(code: code, msg: msg)) }
    }

    func streamSend(_ id: UInt64, _ header: Header, body: Data? = nil) {
        if streams[id] != nil { send(Frame(header: header, body: body)) }
    }

    func streamClose(_ id: UInt64, _ header: Header) {
        guard streams.removeValue(forKey: id) != nil else { return }
        send(Frame(header: header))
    }

    private func route(_ mid: String) -> Route { routed ? Route(mid: mid) : Route() }

    private func request(_ id: UInt64, _ mid: String, _ m: String, _ p: JSON, _ timeout: Duration)
        async throws(CallError) -> JSON
    {
        do {
            return try await withCheckedThrowingContinuation { continuation in
                let timer = Task { [weak self] in
                    guard await pause(timeout) else { return }
                    self?.settle(id, .failure(CallError(code: "timeout", msg: "the machine did not answer in time")))
                }
                pending[id] = Pending(mid: mid, continuation: continuation, timer: timer)
                send(Frame(header: .call(id: id, m: m, p: p, route: route(mid))))
            }
        } catch let error as CallError {
            throw error
        } catch {
            throw CallError(code: "error", msg: "\(error)")
        }
    }

    /// A stream whose call fails never opens: its caller hears of it from the call.
    private func settle(_ id: UInt64, _ result: Result<JSON, CallError>) {
        guard let p = pending.removeValue(forKey: id) else { return }
        p.timer.cancel()
        if case .failure = result { streams.removeValue(forKey: id) }
        p.continuation.resume(with: result.mapError { $0 as any Error })
    }
}
