// One space's connection and the machines it reports, for views to observe.

import Foundation
import IsbellKit
import Observation

@Observable
final class SpaceStore {
    static let relayURL = URL(string: "wss://isbell.fmap.dev/v1/ws")!

    private(set) var status: ConnStatus = .connecting
    private(set) var machines: [MachineEntry] = []
    /// False until the first snapshot arrives.
    private(set) var loaded = false

    @ObservationIgnored private var connection: RelayConnection?

    init(identity: Identity, onRejected: @escaping () -> Void) {
        connection = RelayConnection(url: Self.relayURL, identity: identity) { [weak self] event in
            guard let self else { return }
            switch event {
            case .status(let status):
                self.status = status
                if status == .rejected { onRejected() }
            case .snapshot(let entries):
                machines = Machines.from(snapshot: entries)
                loaded = true
            case .state(let value):
                if let state = MachineState.read(value) { machines = Machines.applying(state: state, to: machines) }
            case .presence(let mid, let online):
                machines = Machines.applying(presence: mid, online: online, to: machines)
            }
        }
    }

    func reconnectNow() {
        connection?.reconnectNow()
    }

    func close() {
        connection?.close()
        connection = nil
    }
}
