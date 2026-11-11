// Sets up a direct link to one machine: a WebRTC DataChannel offered to its gateway's
// `isbell.rtc.offer` through the relay. As the connecting part of web/src/model/direct.ts.

import Foundation
import IsbellKit
import WebRTC

/// The gateway's default STUN servers, so both sides look for their public addresses alike.
private let stun = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]
/// The offer goes out once gathering completes, `settle` after the first public address, or after this.
private let gatherLimit: Duration = .milliseconds(2_500)
/// STUN servers answer within a few hundred milliseconds of each other, so waiting this long after
/// the first public address brings the other family's too.
private let settle: Duration = .milliseconds(500)
/// Offer, answer and the channel opening together.
private let directLimit: Duration = .seconds(10)

@MainActor private let factory: RTCPeerConnectionFactory = {
    RTCInitializeSSL()
    return RTCPeerConnectionFactory()
}()

/// Opens a direct link to machine `mid`, or throws `direct_failed` saying why not.
@MainActor
public func openDirect(_ call: @escaping Caller, mid: String) async throws(CallError) -> DirectLink {
    let deadline = ContinuousClock.now + directLimit
    guard let peer = RTCChannel.make() else { throw CallError(code: "direct_failed", msg: "could not set up a peer connection") }
    do throws(CallError) {
        let pieces = try await peer.connect(call, mid: mid, deadline: deadline)
        let path = await peer.stats().map { pathOf($0.remote) } ?? .internet
        return DirectLink(channel: peer, path: path, pieces: pieces)
    } catch {
        peer.close()
        throw CallError(code: "direct_failed", msg: error.msg)
    }
}

/// One peer connection and its channel: connecting, then carrying a link's messages.
@MainActor
final class RTCChannel: NSObject {
    private let pc: RTCPeerConnection
    private let channel: RTCDataChannel
    private var gatherDone = false
    private var gatherWaiter: CheckedContinuation<Void, Never>?
    private var settling = false
    private var openWaiter: CheckedContinuation<Bool, Never>?
    private var ended = false
    private var onMessage: (@MainActor (Message) -> Void)?
    private var onClosed: (@MainActor () -> Void)?

    static func make() -> RTCChannel? {
        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: stun)]
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherOnce
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = factory.peerConnection(with: config, constraints: constraints, delegate: nil),
              let channel = pc.dataChannel(forLabel: "isbell", configuration: RTCDataChannelConfiguration())
        else { return nil }
        return RTCChannel(pc: pc, channel: channel)
    }

    private init(pc: RTCPeerConnection, channel: RTCDataChannel) {
        self.pc = pc
        self.channel = channel
        super.init()
        pc.delegate = self
        channel.delegate = self
    }

    /// Whether the gateway agreed to pieces. Every step is bounded by `deadline`, but for gathering.
    func connect(_ call: Caller, mid: String, deadline: ContinuousClock.Instant) async throws(CallError) -> Bool {
        let left = { max(.zero, deadline - ContinuousClock.now) }
        let offer = try await describe { done in
            self.pc.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { @Sendable sdp, error in
                done(sdp.map { .success($0.sdp) } ?? .failure(failure("no offer", error)))
            }
        }
        try await settled { done in
            self.pc.setLocalDescription(RTCSessionDescription(type: .offer, sdp: offer)) { @Sendable error in done(error) }
        }
        await gathered()
        // Candidates are not trickled: the offer sent carries them all.
        guard let local = pc.localDescription else { throw CallError(code: "direct_failed", msg: "no local description") }
        let params = offerParams(type: RTCSessionDescription.string(for: local.type), sdp: local.sdp)
        let result = try await call(mid, "isbell.rtc.offer", params, left())
        guard let (sdp, pieces) = readAnswer(result) else {
            throw CallError(code: "direct_failed", msg: "the machine's answer has no description")
        }
        try await settled { done in
            self.pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { @Sendable error in done(error) }
        }
        guard await opened(within: left()) else {
            throw CallError(code: "direct_failed", msg: "no direct link within \(directLimit)")
        }
        return pieces
    }

    // MARK: - Waiting

    /// The end of gathering, `settle` past the first public address, or `gatherLimit`.
    private func gathered() async {
        if gatherDone || pc.iceGatheringState == .complete { return }
        await withCheckedContinuation { continuation in
            gatherWaiter = continuation
            Task { [weak self] in
                if await pause(gatherLimit) { self?.finishGathering() }
            }
        }
    }

    private func finishGathering() {
        gatherDone = true
        gatherWaiter?.resume()
        gatherWaiter = nil
    }

    private func tookCandidate(_ sdp: String) {
        guard !settling, sdp.contains(" typ srflx") else { return }
        settling = true
        Task { [weak self] in
            if await pause(settle) { self?.finishGathering() }
        }
    }

    private func opened(within limit: Duration) async -> Bool {
        if channel.readyState == .open { return true }
        if ended { return false }
        return await withCheckedContinuation { continuation in
            openWaiter = continuation
            Task { [weak self] in
                if await pause(limit) { self?.settleOpen(false) }
            }
        }
    }

    private func settleOpen(_ ok: Bool) {
        openWaiter?.resume(returning: ok)
        openWaiter = nil
    }

    // MARK: - Events, on the main actor

    private func channelChanged(_ state: RTCDataChannelState) {
        if state == .open { settleOpen(true) }
        if state == .closed { end() }
    }

    /// `disconnected` may recover on its own; only failed or closed is the end.
    private func connectionChanged(_ state: RTCPeerConnectionState) {
        if state == .failed || state == .closed { end() }
    }

    private func end() {
        settleOpen(false)
        guard !ended else { return }
        ended = true
        onClosed?()
    }
}

extension RTCChannel: DirectChannel {
    func start(message: @escaping @MainActor (Message) -> Void, closed: @escaping @MainActor () -> Void) {
        onMessage = message
        onClosed = closed
        if ended { closed() }
    }

    /// False as well once the channel is no longer open, so the link ends rather than lose frames.
    func send(_ message: Message) -> Bool {
        let buffer = switch message {
        case .text(let text): RTCDataBuffer(data: Data(text.utf8), isBinary: false)
        case .binary(let data): RTCDataBuffer(data: data, isBinary: true)
        }
        return channel.sendData(buffer)
    }

    /// Ended from this side: no `closed` follows.
    func close() {
        ended = true
        settleOpen(false)
        channel.close()
        pc.close()
    }

    func stats() async -> LinkStats? {
        await withCheckedContinuation { continuation in
            pc.statistics { @Sendable report in continuation.resume(returning: chosenPair(report)) }
        }
    }
}

extension RTCChannel: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let state = dataChannel.readyState
        Task { @MainActor [weak self] in self?.channelChanged(state) }
    }

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let message: Message = buffer.isBinary ? .binary(buffer.data) : .text(String(decoding: buffer.data, as: UTF8.self))
        Task { @MainActor [weak self] in self?.onMessage?(message) }
    }
}

extension RTCChannel: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        guard newState == .complete else { return }
        Task { @MainActor [weak self] in self?.finishGathering() }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let sdp = candidate.sdp
        Task { @MainActor [weak self] in self?.tookCandidate(sdp) }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        Task { @MainActor [weak self] in self?.connectionChanged(newState) }
    }

    // Media and renegotiation never come up on a link that only carries a DataChannel.
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

// MARK: - Completion handlers

/// Runs a WebRTC call whose completion gives a value or an error.
@MainActor
private func describe(_ start: (@escaping @Sendable (Result<String, CallError>) -> Void) -> Void) async throws(CallError) -> String {
    try await withCheckedContinuation { continuation in
        start { continuation.resume(returning: $0) }
    }.get()
}

/// Runs a WebRTC call whose completion gives only an error, if any.
@MainActor
private func settled(_ start: (@escaping @Sendable ((any Error)?) -> Void) -> Void) async throws(CallError) {
    let error: String? = await withCheckedContinuation { continuation in
        start { error in continuation.resume(returning: error.map { "\($0)" }) }
    }
    if let error { throw CallError(code: "direct_failed", msg: error) }
}

private func failure(_ what: String, _ error: (any Error)?) -> CallError {
    CallError(code: "direct_failed", msg: error.map { "\(what): \($0)" } ?? what)
}

/// The pair the transport selected, with the machine's end; nil while none is. Native WebRTC reports
/// the selected pair as still in progress when the channel opens, so the transport's choice is read
/// rather than a succeeded, nominated pair as browsers show it.
private func chosenPair(_ report: RTCStatisticsReport) -> LinkStats? {
    let stats = report.statistics
    guard let pairId = stats.values.lazy.compactMap({ $0.type == "transport" ? $0.values["selectedCandidatePairId"] as? String : nil }).first,
          let pair = stats[pairId],
          let remoteId = pair.values["remoteCandidateId"] as? String,
          let remote = stats[remoteId]
    else { return nil }
    let rtt = (pair.values["currentRoundTripTime"] as? NSNumber).map { Duration.milliseconds(Int(($0.doubleValue * 1000).rounded())) }
    let address = remote.values["address"] as? String ?? remote.values["ip"] as? String
    return LinkStats(rtt: rtt, remote: Endpoint(type: remote.values["candidateType"] as? String ?? "", address: address))
}
