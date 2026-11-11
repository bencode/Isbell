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
