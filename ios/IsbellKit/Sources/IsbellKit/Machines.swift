// The space's machines, kept from the relay's snapshot, state and presence frames.

public struct MachineEntry: Sendable, Equatable, Identifiable {
    public var state: MachineState
    public var online: Bool
    public var id: String { state.machine.id }

    public init(state: MachineState, online: Bool) {
        self.state = state
        self.online = online
    }
}

public enum Machines {
    /// The machines the relay knows, in its order; entries this client cannot read are left out.
    public static func from(snapshot: [SnapshotEntry]) -> [MachineEntry] {
        snapshot.compactMap { entry in
            MachineState.read(entry.state).map { MachineEntry(state: $0, online: entry.online) }
        }
    }

    /// A newer state replaces the machine's in place; a machine not seen before comes online.
    public static func applying(state: MachineState, to list: [MachineEntry]) -> [MachineEntry] {
        guard let i = list.firstIndex(where: { $0.id == state.machine.id }) else {
            return list + [MachineEntry(state: state, online: true)]
        }
        guard isNewer(state, than: list[i].state) else { return list }
        var next = list
        next[i].state = state
        return next
    }

    /// Presence of a machine not in the list is ignored: its state comes first.
    public static func applying(presence mid: String, online: Bool, to list: [MachineEntry]) -> [MachineEntry] {
        list.map { $0.id == mid ? MachineEntry(state: $0.state, online: online) : $0 }
    }
}
