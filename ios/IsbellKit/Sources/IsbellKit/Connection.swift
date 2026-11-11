// One authenticated WebSocket to the relay, as a client. Calls are matched by id; the connection
// comes back on its own after a drop, except when the relay rejects the key.

import Foundation
import os

/// Close code the relay uses when the key does not verify.
private let closeAuthFailed = 4003
private let backoff: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(16), .seconds(30)]
/// How long a call made while the connection is down waits for it, as when the app comes back
/// from the background and dials again.
private let readyWait: Duration = .seconds(5)
/// herdr answers with up to 4 MiB; URLSession takes 1 MiB by default.
private let maxMessage = 16 << 20

public enum ConnStatus: Sendable, Equatable {
    case connecting, open, reconnecting, rejected
}

public struct CallError: Error, Sendable, Equatable {
    public var code: String
    public var msg: String

    public init(code: String, msg: String) {
        self.code = code
        self.msg = msg
    }
}

public enum ConnectionEvent: Sendable {
    case status(ConnStatus)
    case snapshot([SnapshotEntry])
    case state(JSON)
    case presence(mid: String, online: Bool)
}

@MainActor
public final class RelayConnection {
    private struct Pending {
        let mid: String
        let continuation: CheckedContinuation<JSON, any Error>
        let timer: Task<Void, Never>
    }

    private let url: URL
    private let origin: String?
    private let identity: Identity
    private let onEvent: @MainActor (ConnectionEvent) -> Void

    private var task: URLSessionWebSocketTask?
    /// Bumped on each dial and on close, so a socket that is no longer current is not heard.
    private var generation = 0
    /// The relay closes a connection whose first frame is not `auth`, so calls wait for the snapshot.
    private var ready = false
    private var attempt = 0
    private var retry: Task<Void, Never>?
    /// Closed here, or refused by the relay: it does not dial again, and a call fails at once.
    private var closed = false
    private var pending: [UInt64: Pending] = [:]
    private var nextId: UInt64 = 1
    /// Calls waiting for the connection: told true once the snapshot arrives.
    private var waiters: [Int: CheckedContinuation<Bool, Never>] = [:]
    private var nextWaiter = 0

    /// Dials at once.
    public init(url: URL, identity: Identity, onEvent: @escaping @MainActor (ConnectionEvent) -> Void) {
        self.url = url
        self.origin = originOf(url)
        self.identity = identity
        self.onEvent = onEvent
        dial()
    }

    /// Resolves with the result, or throws a CallError.
    public func call(_ mid: String, _ m: String, _ p: JSON, timeout: Duration) async throws(CallError) -> JSON {
        try await whenConnected()
        let id = nextId
        nextId += 1
        do {
            return try await withCheckedThrowingContinuation { continuation in
                let timer = Task { [weak self] in
                    guard await pause(timeout) else { return }
                    self?.settle(id, .failure(CallError(code: "timeout", msg: "the machine did not answer in time")))
                }
                pending[id] = Pending(mid: mid, continuation: continuation, timer: timer)
                send(Frame(header: .call(id: id, m: m, p: p, route: Route(mid: mid))))
            }
        } catch let error as CallError {
            throw error
        } catch {
            throw CallError(code: "error", msg: "\(error)")
        }
    }

    /// Skips the remaining backoff when the network or the app comes back.
    public func reconnectNow() {
        guard let retry else { return }
        retry.cancel()
        dial()
    }

    public func close() {
        closed = true
        retry?.cancel()
        retry = nil
        generation += 1
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        ready = false
        fail(code: "disconnected", msg: "not connected to the relay") { _ in true }
        releaseWaiters(false)
    }

    // MARK: - Socket

    private func dial() {
        retry = nil
        ready = false
        generation += 1
        let current = generation
        onEvent(.status(attempt == 0 ? .connecting : .reconnecting))
        let socket = URLSession.shared.webSocketTask(with: url)
        socket.maximumMessageSize = maxMessage
        task = socket
        socket.resume()
        Task { await receive(socket, current) }
    }

    private func receive(_ socket: URLSessionWebSocketTask, _ current: Int) async {
        while true {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await socket.receive()
            } catch {
                if current == generation { dropped(socket, error) }
                return
            }
            guard current == generation else { return }
            handle(message)
        }
    }

    private func send(_ frame: Frame) {
        guard let task else { return }
        let message: URLSessionWebSocketTask.Message =
            switch encode(frame) {
            case .text(let text): .string(text)
            case .binary(let data): .data(data)
            }
        // A failed send drops the socket, which the receive loop then hears about.
        task.send(message) { error in
            if let error { logger.error("could not send to the relay: \(error)") }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let wire: Message
        switch message {
        case .string(let text): wire = .text(text)
        case .data(let data): wire = .binary(data)
        @unknown default:
            logger.error("unknown kind of WebSocket message from the relay")
            return
        }
        let frame: Frame
        do {
            frame = try decode(wire)
        } catch {
            logger.error("unreadable frame from the relay: \(error.reason)")
            return
        }
        switch frame.header {
        case .challenge(let nonce, let challenged):
            // Signing for another origin would let that relay replay the signature here.
            guard challenged == origin else {
                logger.error("relay challenge is for another origin: \(challenged)")
                task?.cancel(with: .normalClosure, reason: nil)
                return
            }
            let sig = signAuth(identity, role: .client, origin: challenged, nonce: nonce)
            send(Frame(header: .auth(role: .client, pk: identity.pk, sig: sig)))
        case .snapshot(let machines):
            attempt = 0
            ready = true
            releaseWaiters(true)
            onEvent(.snapshot(machines))
            onEvent(.status(.open))
        case .state(let state):
            onEvent(.state(state))
        case .presence(let mid, let online):
            if !online { fail(code: "machine_offline", msg: "the machine went offline") { $0 == mid } }
            onEvent(.presence(mid: mid, online: online))
        case .res(let id, let ok, let r, let e, _):
            settle(id, ok ? .success(r ?? .null) : .failure(CallError(code: e?.code ?? "error", msg: e?.msg ?? "the call failed")))
        default:
            // auth_ok needs nothing; streams are not opened yet.
            break
        }
    }

    private func dropped(_ socket: URLSessionWebSocketTask, _ error: any Error) {
        task = nil
        ready = false
        fail(code: "disconnected", msg: "lost the connection to the relay") { _ in true }
        if socket.closeCode.rawValue == closeAuthFailed {
            closed = true
            releaseWaiters(false)
            onEvent(.status(.rejected))
            return
        }
        if closed { return }
        logger.info("relay connection dropped: \(error)")
        onEvent(.status(.reconnecting))
        let delay = backoff[min(attempt, backoff.count - 1)]
        attempt += 1
        retry = Task { [weak self] in
            guard await pause(delay) else { return }
            self?.dial()
        }
    }

    // MARK: - Calls

    private func whenConnected() async throws(CallError) {
        if ready, task != nil { return }
        guard !closed else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
        let key = nextWaiter
        nextWaiter += 1
        let ok = await withCheckedContinuation { continuation in
            waiters[key] = continuation
            Task { [weak self] in
                guard await pause(readyWait) else { return }
                self?.releaseWaiter(key, false)
            }
            // A retry waiting out its backoff dials now: someone is waiting on it.
            reconnectNow()
        }
        guard ok else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
    }

    private func releaseWaiter(_ key: Int, _ ok: Bool) {
        waiters.removeValue(forKey: key)?.resume(returning: ok)
    }

    private func releaseWaiters(_ ok: Bool) {
        let all = waiters
        waiters = [:]
        all.values.forEach { $0.resume(returning: ok) }
    }

    private func settle(_ id: UInt64, _ result: Result<JSON, CallError>) {
        guard let p = pending.removeValue(forKey: id) else { return }
        p.timer.cancel()
        p.continuation.resume(with: result.mapError { $0 as any Error })
    }

    private func fail(code: String, msg: String, where match: (String) -> Bool) {
        let ids = pending.filter { match($0.value.mid) }.map(\.key)
        ids.forEach { settle($0, .failure(CallError(code: code, msg: msg))) }
    }
}

/// Sleeps; false when the task was cancelled instead, the only way Task.sleep fails.
private func pause(_ duration: Duration) async -> Bool {
    do {
        try await Task.sleep(for: duration)
        return true
    } catch {
        return false
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "connection")
