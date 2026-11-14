// A direct link to one machine: frames on an open channel (a WebRTC DataChannel, set up by
// IsbellRTC), without routing fields, one per message, or in pieces when too long for one and the
// gateway agreed to pieces. As the carrying part of web/src/model/direct.ts.

import Foundation
import os

/// An open message channel to one machine.
@MainActor
public protocol DirectChannel: AnyObject {
    /// Starts handing over each message received; `closed` is called once when the channel ends,
    /// whichever side ended it.
    func start(message: @escaping @MainActor (Message) -> Void, closed: @escaping @MainActor () -> Void)
    /// False when the message could not be queued, as when the send queue is full.
    func send(_ message: Message) -> Bool
    func close()
    /// The pair ICE chose, as last measured; nil while none is chosen.
    func stats() async -> LinkStats?
}

public struct LinkStats: Sendable, Equatable {
    /// Once ICE has measured one.
    public var rtt: Duration?
    /// The machine's end.
    public var remote: Endpoint

    public init(rtt: Duration?, remote: Endpoint) {
        self.rtt = rtt
        self.remote = remote
    }
}

/// Opens a direct link to machine `mid`, signalling through `call` on the relay.
public typealias DirectOpener = @MainActor (_ call: @escaping Caller, _ mid: String) async throws(CallError) -> DirectLink

/// What `isbell.rtc.offer` takes: the offer, and that this side puts pieces back together.
public func offerParams(type: String, sdp: String) -> JSON {
    .object(["offer": .object(["type": .string(type), "sdp": .string(sdp)]), "pieces": .bool(true)])
}

/// The answer's description, and whether the gateway agreed to pieces; one that predates pieces
/// leaves them out. Nil for a result with no answer.
public func readAnswer(_ result: JSON) -> (sdp: String, pieces: Bool)? {
    result["answer"]?["sdp"]?.string.map { ($0, result["pieces"] == .bool(true)) }
}

/// Where this client stands with a machine's direct link.
public enum DirectStatus: Sendable, Equatable {
    /// Not tried yet, or the last failure is old enough to try again.
    case none
    /// The machine is offline, or its gateway cannot open one.
    case unsupported
    case opening
    case open(LinkPath)
    case failed(retryIn: Duration)
}

@MainActor
public final class DirectLink {
    public let path: LinkPath
    /// The gateway takes and sends long frames in pieces, so answers of any size can come this way.
    public let pieces: Bool
    /// Called once when the link ends, whichever side ended it.
    public var onClosed: (@MainActor () -> Void)?

    private let channel: any DirectChannel
    private lazy var router = Router(routed: false) { [weak self] in self?.carry($0) }
    private var assembler = Assembler()
    private var over = false

    public init(channel: any DirectChannel, path: LinkPath, pieces: Bool) {
        self.channel = channel
        self.path = path
        self.pieces = pieces
        channel.start(message: { [weak self] in self?.took($0) }, closed: { [weak self] in self?.close() })
    }

    // The router's `mid` only matches streams to their machine; a direct link has one machine.

    public func call(_ m: String, _ p: JSON, timeout: Duration) async throws(CallError) -> JSON {
        try await router.call("", m, p, timeout: timeout)
    }

    public func open(_ m: String, _ p: JSON, timeout: Duration, events: StreamEvents)
        async throws(CallError) -> (result: JSON, stream: RpcStream)
    {
        try await router.open("", m, p, timeout: timeout, events: events)
    }

    public func stats() async -> LinkStats? {
        await channel.stats()
    }

    public func close() {
        guard !over else { return }
        over = true
        router.fail(code: "disconnected", msg: "lost the direct link to the machine") { _ in true }
        channel.close()
        onClosed?()
    }

    /// A send that fails ends the link, as the gateway's does: the rest of the frame would be
    /// missing, and the gateway would drop what came after it.
    private func carry(_ frame: Frame) {
        guard !over else { return }
        let messages = pieces ? split(frame) : [encode(frame)]
        if !messages.allSatisfy({ channel.send($0) }) {
            logger.error("a direct send failed; ending the link")
            close()
        }
    }

    private func took(_ message: Message) {
        do {
            if let frame = try assembler.take(message) { router.handle(frame) }
        } catch {
            logger.warning("ignoring an unreadable direct message: \(error.reason)")
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "direct")
