import Foundation
import Testing

@testable import IsbellKit

/// A pretend gateway holding a pane: it answers the call, keeps what the client sends, and sends the
/// screen or ends the stream when told.
@MainActor
private final class Gateway {
    var router: Router!
    private(set) var params: JSON?
    private(set) var sent: [Header] = []
    private(set) var inputs: [Data] = []
    private var id: UInt64?

    init() {
        router = Router(routed: true) { [unowned self] in self.take($0) }
    }

    var open: Opener {
        { [router] mid, m, p, timeout, events async throws(CallError) in
            try await router!.open(mid, m, p, timeout: timeout, events: events)
        }
    }

    func screen(_ text: String, cols: UInt16? = nil, rows: UInt16? = nil) {
        guard let id else { return }
        router.handle(Frame(header: .data(id: id, k: .frame, full: false, cols: cols, rows: rows, route: Route()),
                            body: Data(text.utf8)))
    }

    func end(_ e: RpcError?) {
        guard let id else { return }
        router.handle(Frame(header: .end(id: id, e: e, route: Route())))
    }

    private func take(_ frame: Frame) {
        if case .call(let id, _, let p, _) = frame.header {
            self.id = id
            params = p
            Task { @MainActor in self.router.handle(Frame(header: .res(id: id, ok: true, r: .object(["paneId": .null]), e: nil, route: Route()))) }
            return
        }
        sent.append(frame.header)
        if case .data(_, .input, _, _, _, _) = frame.header { inputs.append(frame.body ?? Data()) }
    }
}

@MainActor
private final class Seen {
    var output = Data()
    var sizes: [TermSize] = []
    var ends: [CallError?] = []

    var events: TerminalEvents {
        TerminalEvents(output: { self.output.append($0) }, size: { self.sizes.append($0) }, end: { self.ends.append($0) })
    }
}

@MainActor
@Test func aTerminalTakesThePaneAndTellsItsSizeOnlyWhenItChanges() async throws {
    let gateway = Gateway()
    let seen = Seen()
    _ = try await openTerminal(gateway.open, mid: "m", paneId: "w1:p2", size: TermSize(cols: 48, rows: 30), events: seen.events)
    #expect(gateway.params == .object([
        "target": .string("w1:p2"), "mode": .string("control"), "cols": .int(48), "rows": .int(30), "takeover": .bool(true),
    ]))
    guard case .credit(_, let n, _)? = gateway.sent.first else {
        Issue.record("no credit first")
        return
    }
    #expect(Int(n) == streamWindow)
    gateway.screen("ab", cols: 48, rows: 30)
    gateway.screen("c", cols: 48, rows: 30)
    gateway.screen("", cols: 80, rows: 24)
    #expect(seen.output == Data("abc".utf8))
    #expect(seen.sizes == [TermSize(cols: 48, rows: 30), TermSize(cols: 80, rows: 24)])
}

@MainActor
@Test func typingGoesInOneFrameAndClosingSendsWhatIsLeftFirst() async throws {
    let gateway = Gateway()
    let terminal = try await openTerminal(gateway.open, mid: "m", paneId: "p", size: TermSize(cols: 48, rows: 30),
                                          events: Seen().events)
    terminal.input(Data("l".utf8))
    terminal.input(Data("s".utf8))
    _ = await pause(.milliseconds(120))
    #expect(gateway.inputs == [Data("ls".utf8)])
    terminal.resize(TermSize(cols: 48, rows: 30))
    terminal.resize(TermSize(cols: 40, rows: 20))
    terminal.resize(TermSize(cols: 40, rows: 20))
    let resizes = gateway.sent.filter { if case .data(_, .resize, _, _, _, _) = $0 { true } else { false } }
    #expect(resizes.count == 1)
    terminal.input(Data("\r".utf8))
    terminal.close()
    #expect(gateway.inputs.last == Data("\r".utf8))
    guard case .end? = gateway.sent.last else {
        Issue.record("the stream was not ended last")
        return
    }
}

@MainActor
@Test func aTerminalEndedElsewhereSaysWhetherItWasLost() async throws {
    let taken = Gateway()
    let seenTaken = Seen()
    _ = try await openTerminal(taken.open, mid: "m", paneId: "p", size: TermSize(cols: 48, rows: 30), events: seenTaken.events)
    taken.end(nil)
    let lost = Gateway()
    let seenLost = Seen()
    _ = try await openTerminal(lost.open, mid: "m", paneId: "p", size: TermSize(cols: 48, rows: 30), events: seenLost.events)
    lost.end(RpcError(code: "disconnected", msg: "lost the connection to the relay"))
    #expect(seenTaken.ends == [nil])
    #expect(seenLost.ends == [CallError(code: "disconnected", msg: "lost the connection to the relay")])
}
