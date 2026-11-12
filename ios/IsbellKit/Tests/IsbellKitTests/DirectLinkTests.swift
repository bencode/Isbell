import Foundation
import Testing

@testable import IsbellKit

/// A channel to a pretend gateway: each call is answered with `answer`, in pieces when long.
@MainActor
private final class FakeChannel: DirectChannel {
    var answer: JSON = .null
    var silent = false
    private(set) var closes = 0
    private var message: (@MainActor (Message) -> Void)?
    private var closed: (@MainActor () -> Void)?
    private var assembler = Assembler()

    func start(message: @escaping @MainActor (Message) -> Void, closed: @escaping @MainActor () -> Void) {
        self.message = message
        self.closed = closed
    }

    func send(_ sent: Message) -> Bool {
        let frame: Frame?
        do {
            frame = try assembler.take(sent)
        } catch {
            Issue.record("the link sent an unreadable message: \(error.reason)")
            return false
        }
        guard !silent, case .call(let id, _, _, let route)? = frame?.header else { return true }
        #expect(route == Route(), "frames on a direct link carry no routing")
        let reply = Frame(header: .res(id: id, ok: true, r: answer, e: nil, route: Route()))
        Task { @MainActor in split(reply).forEach { self.message?($0) } }
        return true
    }

    func close() { closes += 1 }

    func stats() async -> LinkStats? { nil }

    /// The far side ends the channel.
    func hangUp() { closed?() }
}

@MainActor
@Test func callsGoOverTheChannelAndLongAnswersComeInPieces() async throws {
    let channel = FakeChannel()
    let link = DirectLink(channel: channel, path: .lan, pieces: true)
    channel.answer = .object(["ok": .bool(true)])
    #expect(try await link.call("isbell.system", .object([:]), timeout: .seconds(5)) == channel.answer)
    channel.answer = .string(String(repeating: "x", count: 3 * piece))
    #expect(try await link.call("herdr", .object([:]), timeout: .seconds(5)) == channel.answer)
}

@MainActor
@Test func aChannelThatEndsFailsWhatIsInFlightAndClosesOnce() async {
    let channel = FakeChannel()
    channel.silent = true
    let link = DirectLink(channel: channel, path: .lan, pieces: true)
    var closedCount = 0
    link.onClosed = { closedCount += 1 }
    let call = Task { () async -> CallError? in
        do throws(CallError) {
            _ = try await link.call("isbell.system", .object([:]), timeout: .seconds(5))
            return nil
        } catch {
            return error
        }
    }
    await Task.yield()
    channel.hangUp()
    link.close()
    #expect(await call.value?.code == "disconnected")
    #expect(closedCount == 1)
    #expect(channel.closes == 1)
}

@MainActor
@Test func closingTheLinksKeepsTheirFailuresAndOnlyAResetForgetsThem() async {
    let links = DirectLinks(open: { _, _ async throws(CallError) in throw CallError(code: "timeout", msg: "no answer") },
                            relay: { _, _, _, _ async throws(CallError) in .null }, signals: { true },
                            directable: { _ in true })
    #expect(await links.to("m")?.value == nil)
    // A first failure is tried again soon.
    #expect(failed(links.status("m"), within: .seconds(30)))
    // As when the app goes behind: the machine that could not be reached is not tried again.
    links.closeAll()
    #expect(failed(links.status("m")))
    #expect(links.to("m") == nil)
    // As when the network is of another kind.
    links.reset()
    #expect(links.status("m") == .none)
}

@MainActor
@Test func aLinkIsNotTriedWhileTheRelayCannotCarryItsOffer() async {
    var up = false
    var opened = 0
    let links = DirectLinks(open: { _, _ async throws(CallError) in
        opened += 1
        throw CallError(code: "direct_failed", msg: "no answer")
    }, relay: { _, _, _, _ async throws(CallError) in .null }, signals: { up }, directable: { _ in true })
    // As while a ping after coming back is not answered yet: no attempt, and no failure kept.
    #expect(links.to("m") == nil)
    #expect(links.status("m") == .none)
    #expect(opened == 0)
    up = true
    #expect(await links.to("m")?.value == nil)
    #expect(opened == 1)
}

private func failed(_ status: DirectStatus, within limit: Duration = .seconds(5 * 60)) -> Bool {
    if case .failed(let retryIn) = status { retryIn <= limit } else { false }
}
