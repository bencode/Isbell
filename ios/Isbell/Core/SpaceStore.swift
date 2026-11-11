// One space as the screens see it: what IsbellKit's Space knows, made into projects and lanes with
// what this iPhone remembers. While the app is in front, the machines' panes are pulled again every
// 15 s, as the web does; a network that comes back reconnects at once.

import Foundation
import IsbellKit
import Network
import Observation

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
    // The first path the monitor reports is the one at start, not a change.
    @ObservationIgnored private var pathKnown = false

    init(identity: Identity, prefs: Prefs, onRejected: @escaping @MainActor () -> Void) {
        self.identity = identity
        self.prefs = prefs
        space = Space(url: Self.relayURL, identity: identity, onRejected: onRejected)
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

    /// In front, the panes are pulled now and every 15 s; behind, not at all.
    func setActive(_ on: Bool) {
        active = on
        ticking?.cancel()
        ticking = nil
        guard on else { return }
        space.reconnectNow()
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
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.took(path: satisfied) }
        }
        monitor.start(queue: .main)
    }

    private func took(path satisfied: Bool) {
        defer { pathKnown = true }
        guard pathKnown, satisfied else { return }
        space.reconnectNow()
        if active { Task { await space.refreshShells() } }
    }
}
