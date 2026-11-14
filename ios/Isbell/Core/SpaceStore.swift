// One space as the screens see it: what IsbellKit's Space knows, made into projects and lanes with
// what this iPhone remembers. While the app is in front, the machines' panes are pulled again every
// 15 s, as the web does. Coming back to the front or onto a network of another kind, the relay
// connection is checked and dialed again if it is gone. Direct links are closed when the app goes
// behind and set up again by the next call; a network of another kind also forgets their failures.

import Foundation
import IsbellKit
import IsbellRTC
import Network
import Observation
import os

/// The kind of network the phone is on; a change between kinds, not within one (LTE to 5G), is a
/// new network.
private enum NetKind: String {
    case wifi, cellular, wired, other

    nonisolated init(_ path: NWPath) {
        let kinds: [(NWInterface.InterfaceType, NetKind)] = [(.wifi, .wifi), (.cellular, .cellular), (.wiredEthernet, .wired)]
        self = kinds.first { path.usesInterfaceType($0.0) }?.1 ?? .other
    }
}

@Observable
final class SpaceStore {
    static let relayURL = URL(string: "wss://isbell.fmap.dev/v1/ws")!
    private static let refreshEvery: Duration = .seconds(15)

    let space: Space
    let prefs: Prefs
    let identity: Identity

    @ObservationIgnored private var ticking: Task<Void, Never>?
    @ObservationIgnored private var active = false
    @ObservationIgnored private var closed = false
    @ObservationIgnored private let monitor = NWPathMonitor()
    /// The network the phone is on, nil while there is none or none was reported yet.
    @ObservationIgnored private var netKind: NetKind?
    // The first network the monitor reports is the one at start, not a change.
    @ObservationIgnored private var pathKnown = false

    init(identity: Identity, prefs: Prefs, onRejected: @escaping @MainActor () -> Void) {
        self.identity = identity
        self.prefs = prefs
        space = Space(url: Self.relayURL, identity: identity, openDirect: { call, mid async throws(CallError) in
            try await openDirect(call, mid: mid)
        }, onRejected: onRejected)
        keepListed()
        watchNetwork()
    }

    var projects: [Project] {
        deriveProjects(space.machines, shells: space.shells, seen: prefs.seen, repos: space.repos,
                       recorded: space.recorded, listed: listedPaths(space.configs, kept: prefs.keptPaths),
                       titles: space.titles)
    }

    var lanes: Lanes { IsbellKit.lanes(projects) }

    var call: Caller { space.call }

    /// In front, the relay connection is checked, which iOS may have cut while the app was
    /// suspended, and the panes are pulled now and every 15 s; behind, not at all, and the direct
    /// links, which iOS cuts too, are closed.
    func setActive(_ on: Bool) {
        active = on
        ticking?.cancel()
        ticking = nil
        guard on else {
            space.closeDirect()
            return
        }
        space.probeRelay()
        ticking = Task { [weak self] in
            repeat {
                guard let self else { return }
                await space.refreshShells()
                space.refreshUnreadLists()
            } while await pause(Self.refreshEvery)
        }
    }

    func close() {
        closed = true
        ticking?.cancel()
        monitor.cancel()
        space.close()
    }

    /// Keeps what each machine lists, to show while it is not read: whenever what is read changes,
    /// until the space is left.
    private func keepListed() {
        guard !closed else { return }
        prefs.keep(listedPaths(space.configs, kept: prefs.keptPaths))
        withObservationTracking { _ = space.configs } onChange: { [weak self] in
            Task { @MainActor in self?.keepListed() }
        }
    }

    private func watchNetwork() {
        monitor.pathUpdateHandler = { [weak self] path in
            let kind = path.status == .satisfied ? NetKind(path) : nil
            Task { @MainActor in self?.took(network: kind) }
        }
        monitor.start(queue: .main)
    }

    /// `kind`: nil for no network.
    private func took(network kind: NetKind?) {
        let was = netKind
        netKind = kind
        defer { pathKnown = true }
        guard pathKnown, let kind, kind != was else { return }
        logger.info("network is now \(kind.rawValue)")
        // Links on the old network no longer carry, and one that failed there may work on this one.
        space.resetDirect()
        space.probeRelay()
        if active { Task { await space.refreshShells() } }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "network")
