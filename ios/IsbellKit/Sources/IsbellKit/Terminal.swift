// A terminal on a machine: an `isbell.terminal` stream in control mode. Output is granted back as it
// reaches the screen, so a slow screen slows the machine instead of piling up. As
// web/src/model/terminal.ts.

import Foundation

public struct TermSize: Hashable, Sendable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

public struct TerminalEvents {
    /// Bytes for the screen, written before this returns: they are granted back to the machine then.
    public var output: @MainActor (Data) -> Void
    /// The pane's size, when it changes.
    public var size: @MainActor (TermSize) -> Void
    /// Once: nil when it was ended elsewhere (taken by another screen, or the pane closed), else why.
    public var end: @MainActor (CallError?) -> Void

    public init(output: @escaping @MainActor (Data) -> Void, size: @escaping @MainActor (TermSize) -> Void,
                end: @escaping @MainActor (CallError?) -> Void) {
        self.output = output
        self.size = size
        self.end = end
    }
}

private let openTimeout: Duration = .seconds(50)
/// The gateway ends a terminal that hears nothing for 45 s.
private let pingEvery: Duration = .seconds(15)
/// Every keystroke would be a frame, and the relay allows 50 a second: typing goes in batches. On a
/// direct link the web sends each at once; 30 ms is not felt there, and the stream does not say
/// which way it went.
private let inputBatch: Duration = .milliseconds(30)

@MainActor
public final class Terminal {
    private let stream: RpcStream
    private var sent: TermSize
    private var batch = Data()
    private var flush: Task<Void, Never>?
    private var pinging: Task<Void, Never>?

    init(stream: RpcStream, size: TermSize) {
        self.stream = stream
        sent = size
    }

    public func input(_ bytes: Data) {
        batch.append(bytes)
        guard flush == nil else { return }
        flush = Task { [weak self] in
            guard await pause(inputBatch) else { return }
            self?.sendBatch()
        }
    }

    public func resize(_ size: TermSize) {
        guard size != sent else { return }
        sent = size
        stream.send(.resize, cols: UInt16(clamping: size.cols), rows: UInt16(clamping: size.rows))
    }

    /// Detaches; the pane stays in herdr.
    public func close() {
        if !batch.isEmpty { sendBatch() }
        stop()
        stream.close()
    }

    fileprivate func consumed(_ n: Int) {
        stream.consumed(n)
    }

    fileprivate func startPinging() {
        pinging = Task { [weak self] in
            while await pause(pingEvery) {
                guard let self else { return }
                stream.send(.ping)
            }
        }
    }

    fileprivate func stop() {
        flush?.cancel()
        flush = nil
        pinging?.cancel()
        pinging = nil
    }

    private func sendBatch() {
        flush?.cancel()
        flush = nil
        let bytes = batch
        batch = Data()
        stream.send(.input, body: bytes)
    }
}

/// Attaches to pane `paneId` on machine `mid` in control mode, taking it from any other screen.
@MainActor
public func openTerminal(_ open: Opener, mid: String, paneId: String, size: TermSize,
                         events: TerminalEvents) async throws(CallError) -> Terminal {
    let link = Link()
    let streamEvents = StreamEvents(frame: { body, size in
        link.took(body, size, events)
    }, end: { error in
        link.terminal?.stop()
        events.end(error.map { CallError(code: $0.code, msg: $0.msg) })
    })
    // herdr lets one client hold a terminal: the last to open it has it, from another screen or from
    // a connection lost that still holds it until the gateway gives up on it.
    let params: JSON = .object([
        "target": .string(paneId), "mode": .string("control"),
        "cols": .int(Int64(size.cols)), "rows": .int(Int64(size.rows)), "takeover": .bool(true),
    ])
    let (_, stream) = try await open(mid, "isbell.terminal", params, openTimeout, streamEvents)
    // The gateway holds the screen until it has credit, so nothing comes before this.
    stream.grant(streamWindow)
    let terminal = Terminal(stream: stream, size: size)
    link.terminal = terminal
    terminal.startPinging()
    return terminal
}

/// What the stream's events need of the terminal opened on it, and the size last told.
@MainActor
private final class Link {
    weak var terminal: Terminal?
    private var shown: TermSize?

    func took(_ body: Data, _ size: TermSize?, _ events: TerminalEvents) {
        if let size, size != shown {
            shown = size
            events.size(size)
        }
        guard !body.isEmpty else { return }
        events.output(body)
        terminal?.consumed(body.count)
    }
}
