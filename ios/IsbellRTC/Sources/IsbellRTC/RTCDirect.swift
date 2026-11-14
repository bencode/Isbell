// Sets up a direct link to one machine: a WebRTC DataChannel offered to its gateway's
// `isbell.rtc.offer` through the relay. As the connecting part of web/src/model/direct.ts, but for
// what a phone's native WebRTC needs over cellular: STUN names resolved by the system, servers it
// reaches from China, fewer addresses offered, and longer waits.

import Foundation
import IsbellKit
import WebRTC
import os

/// STUN servers that answered from China within 40 ms, and Cloudflare's for elsewhere. Google's, which
/// the gateway also asks, a phone in China mostly does not reach.
private let stun = [
    (host: "stun.miwifi.com", port: 3478), (host: "stun.chat.bilibili.com", port: 3478),
    (host: "stun.cloudflare.com", port: 3478),
]
/// The offer goes out once gathering completes, `settle` after the public IPv4 address, or after this.
/// Over cellular that address takes up to several seconds to come, and without it the machine has no
/// way through the carrier's NAT.
private let gatherLimit: Duration = .seconds(5)
/// STUN servers answer within a few hundred milliseconds of each other, so waiting this long after
/// the public IPv4 address brings the IPv6 one too.
private let settle: Duration = .milliseconds(500)
/// The offer and its answer, through the relay, which took 8 s just after it connected.
private let answerLimit: Duration = .seconds(10)
/// The channel opening once the answer is in: as long as the gateway waits for it.
private let openLimit: Duration = .seconds(10)

@MainActor private let factory: RTCPeerConnectionFactory = {
    RTCInitializeSSL()
    return RTCPeerConnectionFactory()
}()

/// Opens a direct link to machine `mid`, or throws `direct_failed` saying why not.
@MainActor
public func openDirect(_ call: @escaping Caller, mid: String) async throws(CallError) -> DirectLink {
    guard let peer = RTCChannel.make(stun: await stunURLs()) else { throw CallError(code: "direct_failed", msg: "could not set up a peer connection") }
    do throws(CallError) {
        let pieces = try await peer.connect(call, mid: mid)
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

    static func make(stun: [String]) -> RTCChannel? {
        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: stun)]
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherOnce
        // Only UDP, which is all the gateway checks, no link-local addresses, and one IPv6 network of
        // the several cellular ones a phone has: each address more is pairs the gateway checks, IPv6
        // ones first, before the one that works, its LAN address to the phone's public IPv4.
        config.tcpCandidatePolicy = .disabled
        config.disableLinkLocalNetworks = true
        config.maxIPv6Networks = 1
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

    /// Whether the gateway agreed to pieces.
    func connect(_ call: Caller, mid: String) async throws(CallError) -> Bool {
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
        let result = try await call(mid, "isbell.rtc.offer", params, answerLimit)
        guard let (sdp, pieces) = readAnswer(result) else {
            throw CallError(code: "direct_failed", msg: "the machine's answer has no description")
        }
        try await settled { done in
            self.pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { @Sendable error in done(error) }
        }
        guard await opened(within: openLimit) else {
            throw CallError(code: "direct_failed", msg: "no direct link within \(openLimit) of the answer")
        }
        return pieces
    }

    // MARK: - Waiting

    /// The end of gathering, `settle` past the public IPv4 address, or `gatherLimit`.
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
        guard !settling, publicIPv4(sdp) else { return }
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

/// Whether a candidate is a public IPv4 address, as STUN tells it: `candidate:<f> <c> <proto>
/// <priority> <address> <port> typ <type> …`.
private func publicIPv4(_ candidate: String) -> Bool {
    let fields = candidate.split(separator: " ")
    return fields.count > 7 && fields[7] == "srflx" && !fields[4].contains(":")
}

// MARK: - STUN servers

/// The STUN servers by address, as the system resolves their names: WebRTC's own lookup of them over
/// cellular took seconds or never ended, which left the offer without the phone's public address. A
/// name the system cannot resolve is left to WebRTC.
private func stunURLs() async -> [String] {
    await withTaskGroup(of: [String].self) { group in
        for server in stun { group.addTask { await stunURLs(server.host, server.port) } }
        return await group.reduce(into: []) { $0 += $1 }
    }
}

/// Resolved off the concurrency pool, as a lookup blocks its thread until the system answers.
private func stunURLs(_ host: String, _ port: Int) async -> [String] {
    let addresses = await withCheckedContinuation { continuation in
        DispatchQueue.global().async { continuation.resume(returning: resolve(host)) }
    }
    if addresses.isEmpty { return ["stun:\(host):\(port)"] }
    return addresses.map { $0.contains(":") ? "stun:[\($0)]:\(port)" : "stun:\($0):\(port)" }
}

/// The addresses the system gives for `host`, IPv4 and IPv6.
private func resolve(_ host: String) -> [String] {
    var hints = addrinfo()
    hints.ai_family = AF_UNSPEC
    hints.ai_socktype = SOCK_DGRAM
    var list: UnsafeMutablePointer<addrinfo>?
    let status = getaddrinfo(host, nil, &hints, &list)
    guard status == 0, let first = list else {
        logger.warning("cannot resolve \(host), left to WebRTC: \(String(cString: gai_strerror(status)))")
        return []
    }
    defer { freeaddrinfo(first) }
    let names = sequence(first: first) { $0.pointee.ai_next }.compactMap { info -> String? in
        var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(info.pointee.ai_addr, info.pointee.ai_addrlen, &name, socklen_t(name.count), nil, 0, NI_NUMERICHOST) == 0
        else { return nil }
        return String(decoding: name.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
    return names.reduce(into: []) { found, name in if !found.contains(name) { found.append(name) } }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "direct")

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
