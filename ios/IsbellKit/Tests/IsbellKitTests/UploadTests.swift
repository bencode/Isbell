import Foundation
import Testing

@testable import IsbellKit

/// A pretend gateway taking an upload: it answers the call with where the file lands, gives credit
/// `step` at a time whenever less than a chunk of it is left, and ends the stream as the client
/// does, or on the first chunk with `refuse`.
@MainActor
private final class Gateway {
    var router: Router!
    let step: Int
    let refuse: RpcError?
    private(set) var chunks: [Data] = []
    private(set) var granted = 0
    private(set) var overdrawn = false
    private(set) var finished = false
    private(set) var afterEnd = false

    init(step: Int, refuse: RpcError? = nil) {
        self.step = step
        self.refuse = refuse
        router = Router(routed: true) { [unowned self] in self.take($0) }
    }

    var open: Opener {
        { [router] mid, m, p, timeout, events async throws(CallError) in
            try await router!.open(mid, m, p, timeout: timeout, events: events)
        }
    }

    private func take(_ frame: Frame) {
        switch frame.header {
        case .call(let id, _, _, _):
            later(.res(id: id, ok: true, r: .object(["path": .string("/tmp/isbell-uploads/0123abcd/a.bin")]), e: nil, route: Route()))
            grant(id)
        case .data(let id, .chunk, _, _, _, _):
            if finished { afterEnd = true }
            chunks.append(frame.body ?? Data())
            let got = chunks.reduce(0) { $0 + $1.count }
            if got > granted { overdrawn = true }
            if let refuse { return later(.end(id: id, e: refuse, route: Route())) }
            if granted - got < maxChunk { grant(id) }
        case .end(let id, _, _):
            finished = true
            later(.end(id: id, e: nil, route: Route()))
        default:
            break
        }
    }

    private func grant(_ id: UInt64) {
        granted += step
        later(.credit(id: id, n: UInt64(step), route: Route()))
    }

    private func later(_ header: Header) {
        Task { @MainActor in self.router.handle(Frame(header: header)) }
    }
}

@MainActor
@Test func anUploadGoesInChunksWithinTheCreditGivenThenEnds() async throws {
    let bytes = Data((0..<300_000).map { UInt8($0 % 251) })
    let gateway = Gateway(step: 100 << 10)
    var progress: [Int] = []
    let path = try await upload(gateway.open, mid: "m", name: "a.bin", bytes: bytes) { progress.append($0) }
    #expect(path == "/tmp/isbell-uploads/0123abcd/a.bin")
    #expect(gateway.chunks.allSatisfy { $0.count <= maxChunk })
    #expect(gateway.chunks.reduce(Data(), +) == bytes)
    #expect(!gateway.overdrawn, "nothing goes out beyond the credit given")
    #expect(gateway.finished && !gateway.afterEnd)
    #expect(progress.last == bytes.count)
}

@MainActor
@Test func anUploadTheMachineRefusesStopsWithItsError() async {
    let gateway = Gateway(step: 1 << 20, refuse: RpcError(code: "io", msg: "no space left"))
    do {
        _ = try await upload(gateway.open, mid: "m", name: "a.bin", bytes: Data(count: 200_000)) { _ in }
        Issue.record("the upload went through")
    } catch {
        #expect(error.code == "io")
    }
    #expect(gateway.chunks.count == 1)
    #expect(!gateway.finished)
}

@Test func whatWasSentShowsItsWordsAndTheImagesUploadedWithIt() {
    let sent = Sent(text: "look\n/tmp/isbell-uploads/0123abcd/a.png\n/tmp/isbell-uploads/89abcdef/notes.txt", at: 1, after: .start)
    #expect(sent.asked == Asked(text: "look\n/tmp/isbell-uploads/89abcdef/notes.txt", images: ["/tmp/isbell-uploads/0123abcd/a.png"]))
}
