// What this client knows of its space: each machine's latest state and whether it is online (pushed
// by the relay), each machine's plain shells and its agents' titles (pulled from herdr, since
// machine state lists only agents), and the projects it lists and its recorded sessions ran in (read
// from the machine's files). Calls and streams take a machine's direct link when one is open, else
// the relay; a link is set up only while the relay is known to carry. As web/src/model/space.ts,
// reading only.

import Foundation
import Observation
import os

public struct MachineEntry: Sendable, Equatable, Identifiable {
    public var state: MachineState
    public var online: Bool
    public var id: String { state.machine.id }

    public init(state: MachineState, online: Bool) {
        self.state = state
        self.online = online
    }
}

/// Far above what years of projects take.
private let rootsMax = 1 << 20
/// How long a stream waits for a direct link being set up before it takes the relay; the link keeps
/// opening, for the streams after it.
private let directWait: Duration = .seconds(4)

@MainActor
@Observable
public final class Space {
    public private(set) var status: ConnStatus = .connecting
    /// False until the first snapshot arrives.
    public private(set) var loaded = false
    /// Ordered by name, then id.
    public private(set) var machines: [MachineEntry] = []
    /// The task of each agent's pane, by machine id and pane id, where its terminal's title names one.
    public private(set) var titles: [String: [String: String]] = [:]
    /// The repository root of each directory reported, by `dirKey(mid, cwd)`.
    public private(set) var repos: [String: String] = [:]
    /// Where each machine's recorded sessions ran, by machine id.
    public private(set) var recorded: [String: Roots] = [:]
    /// What each machine lists as its projects, by machine id; none for a machine not read yet.
    public private(set) var configs: [String: ProjectConfig] = [:]
    private var shellsByMachine: [String: [Shell]] = [:]

    public var shells: [Shell] { shellsByMachine.values.flatMap(\.self) }

    @ObservationIgnored private var connection: RelayConnection?
    @ObservationIgnored private let onRejected: @MainActor () -> Void
    // Set in init, once self can be captured by its closures.
    @ObservationIgnored private var links: DirectLinks!
    // A newer pull for a machine wins over a slower, older one: the pull each started, and the one
    // whose shells it shows.
    @ObservationIgnored private var pulls: [String: Int] = [:]
    @ObservationIgnored private var taken: [String: Int] = [:]
    // The directories asked about, so each is asked once.
    @ObservationIgnored private var asked: Set<String> = []
    // The machines whose files are read now, and those to read once more after.
    @ObservationIgnored private var reads: Set<String> = []
    @ObservationIgnored private var again: Set<String> = []

    /// `openDirect` sets up direct links; without it everything goes through the relay.
    public init(url: URL, identity: Identity, openDirect: DirectOpener? = nil,
                onRejected: @escaping @MainActor () -> Void) {
        self.onRejected = onRejected
        connection = RelayConnection(url: url, identity: identity) { [weak self] in self?.handle($0) }
        links = DirectLinks(open: openDirect, relay: { [weak self] mid, m, p, timeout async throws(CallError) -> JSON in
            guard let self else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
            return try await relayCall(mid, m, p, timeout: timeout)
        }, signals: { [weak self] in self?.connection?.live ?? false },
        directable: { [weak self] in self?.directable($0) ?? false })
    }

    /// Calls machine `mid` over its direct link when one is open and takes pieces, else over the
    /// relay; a call to the relay, once the relay is known to carry, starts a link for the calls
    /// after it.
    public var call: Caller {
        { [weak self] mid, m, p, timeout async throws(CallError) -> JSON in
            guard let self else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
            if let link = links.callLink(mid) { return try await link.call(m, p, timeout: timeout) }
            // Not waited for, unlike a stream: it serves the calls after this one.
            _ = links.to(mid)
            return try await relayCall(mid, m, p, timeout: timeout)
        }
    }

    /// Opens a stream on machine `mid`, over its direct link when one is open or opens in time.
    public var open: Opener {
        { [weak self] mid, m, p, timeout, events async throws(CallError) in
            guard let self else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
            if let opening = links.to(mid), let link = await within(directWait, opening) {
                return try await link.open(m, p, timeout: timeout, events: events)
            }
            guard let connection else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
            return try await connection.open(mid, m, p, timeout: timeout, events: events)
        }
    }

    /// Where machine `mid`'s direct link stands.
    public func directStatus(_ mid: String) -> DirectStatus { links.status(mid) }

    /// The path calls to `mid` take now; nil for the relay.
    public func callVia(_ mid: String) -> LinkPath? { links.callLink(mid)?.path }

    /// The pair machine `mid`'s open direct link uses, if one is open.
    public func directStats(_ mid: String) async -> LinkStats? { await links.stats(mid) }

    /// Closes every direct link and forgets their failures, for a network of another kind: the next
    /// call sets one up again.
    public func resetDirect() { links.reset() }

    /// Closes every direct link and keeps their failures, for an app going behind: iOS cuts the
    /// links while it is suspended, and a machine that could not be reached still cannot.
    public func closeDirect() { links.closeAll() }

    /// Pulls the shells of every machine online.
    public func refreshShells() async {
        let pulling = machines.map(\.id).map { mid in Task { await refreshOne(mid) } }
        for pull in pulling { await pull.value }
    }

    /// Reads again what the machines list where it could not be read: a machine with nothing new
    /// to say would otherwise never be asked again.
    public func refreshUnreadLists() {
        for m in machines where configs[m.id] == nil && readable(m.id) {
            Task { await refreshConfig(m.id) }
        }
    }

    /// Checks the relay connection is still there, as after the app was behind: see
    /// RelayConnection.probe.
    public func probeRelay() {
        connection?.probe()
    }

    public func close() {
        links.closeAll()
        connection?.close()
        connection = nil
    }

    // MARK: - Merging what the relay says

    /// The machines the relay knows, in its order; entries this client cannot read are left out.
    nonisolated public static func from(snapshot: [SnapshotEntry]) -> [MachineEntry] {
        snapshot.compactMap { entry in
            MachineState.read(entry.state).map { MachineEntry(state: $0, online: entry.online) }
        }
    }

    /// A newer state replaces the machine's in place; a machine not seen before comes online.
    nonisolated public static func applying(state: MachineState, to list: [MachineEntry]) -> [MachineEntry] {
        guard let i = list.firstIndex(where: { $0.id == state.machine.id }) else {
            return list + [MachineEntry(state: state, online: true)]
        }
        guard isNewer(state, than: list[i].state) else { return list }
        var next = list
        next[i].state = state
        return next
    }

    /// Presence of a machine not in the list is ignored: its state comes first.
    nonisolated public static func applying(presence mid: String, online: Bool, to list: [MachineEntry]) -> [MachineEntry] {
        list.map { $0.id == mid ? MachineEntry(state: $0.state, online: online) : $0 }
    }

    nonisolated private static func sorted(_ list: [MachineEntry]) -> [MachineEntry] {
        list.sorted {
            let byName = $0.state.machine.name.localizedCompare($1.state.machine.name)
            return byName == .orderedSame ? $0.id < $1.id : byName == .orderedAscending
        }
    }

    private func handle(_ event: ConnectionEvent) {
        switch event {
        case .status(let next):
            status = next
            if next == .rejected { onRejected() }
        case .snapshot(let entries):
            took(snapshot: entries)
        case .state(let value):
            if let state = MachineState.read(value) { took(state: state) }
        case .presence(let mid, let online):
            took(presence: mid, online: online)
        }
    }

    private func took(snapshot entries: [SnapshotEntry]) {
        machines = Self.sorted(Self.from(snapshot: entries))
        configs = [:]
        let online = Set(machines.filter(\.online).map(\.id))
        machines.filter { !$0.online }.forEach { links.drop($0.id) }
        shellsByMachine = shellsByMachine.filter { online.contains($0.key) }
        titles = titles.filter { online.contains($0.key) }
        loaded = true
        machines.forEach { findRepos($0.id) }
        Task { await refreshShells() }
        machines.forEach { refreshFiles($0.id) }
    }

    private func took(state: MachineState) {
        let mid = state.machine.id
        if let old = machine(mid) {
            guard isNewer(state, than: old.state) else { return }
            if state.boot > old.state.boot {
                connection?.failMachine(mid)
                links.drop(mid)
            }
        }
        machines = Self.sorted(Self.applying(state: state, to: machines))
        findRepos(mid)
        Task { await refreshOne(mid) }
        // A session's turn that ends changes the state, and what it recorded.
        refreshFiles(mid)
    }

    private func took(presence mid: String, online: Bool) {
        guard machine(mid) != nil else { return }
        machines = Self.applying(presence: mid, online: online, to: machines)
        if online {
            configs[mid] = nil
            Task { await refreshOne(mid) }
            refreshFiles(mid)
        } else {
            shellsByMachine[mid] = nil
            titles[mid] = nil
            links.drop(mid)
        }
    }

    // MARK: - Direct links

    private func directable(_ mid: String) -> Bool {
        machine(mid).map { $0.online && $0.state.caps.methods.contains("isbell.rtc.offer") } ?? false
    }

    private func relayCall(_ mid: String, _ m: String, _ p: JSON, timeout: Duration) async throws(CallError) -> JSON {
        guard let connection else { throw CallError(code: "disconnected", msg: "not connected to the relay") }
        return try await connection.call(mid, m, p, timeout: timeout)
    }

    // MARK: - Pulling from the machines

    private func machine(_ mid: String) -> MachineEntry? { machines.first { $0.id == mid } }

    private func pullable(_ mid: String) -> Bool {
        machine(mid).map { $0.online && $0.state.herdr.status == .ready } ?? false
    }

    private func readable(_ mid: String) -> Bool {
        machine(mid).map { $0.online && $0.state.caps.methods.contains("isbell.file.read") } ?? false
    }

    /// Asks machine `mid` which repository each directory it reports is in, once for each.
    private func findRepos(_ mid: String) {
        guard let m = machine(mid), m.online, m.state.caps.methods.contains("isbell.file.list") else { return }
        let cwds = Set(m.state.agents.compactMap(\.cwd) + (shellsByMachine[mid] ?? []).map(\.cwd))
        for cwd in cwds where !cwd.isEmpty && !asked.contains(dirKey(mid, cwd)) {
            let key = dirKey(mid, cwd)
            asked.insert(key)
            Task {
                do throws(CallError) {
                    if let root = try await repoRootOf(call, mid: mid, dir: cwd) { repos[key] = root }
                } catch {
                    // Asked again on the next report; until then it stands as its own project.
                    asked.remove(key)
                    logger.warning("could not find the repository of \(cwd): \(error.msg)")
                }
            }
        }
    }

    /// The machine's shells and titles, unless a newer pull has come back first.
    private func refreshOne(_ mid: String) async {
        guard pullable(mid) else { return }
        let seq = (pulls[mid] ?? 0) + 1
        pulls[mid] = seq
        do {
            let found = try await panes(call, mid: mid)
            guard seq >= (taken[mid] ?? 0) else { return }
            taken[mid] = seq
            shellsByMachine[mid] = found.shells
            titles[mid] = found.titles
            findRepos(mid)
        } catch {
            // The last pull stands.
            logger.warning("could not list the panes of \(mid): \(error.msg)")
        }
    }

    /// Reads the files machine `mid`'s projects come from. Asked while a read is out, it reads once
    /// more after.
    private func refreshFiles(_ mid: String) {
        guard readable(mid) else { return }
        guard !reads.contains(mid) else {
            again.insert(mid)
            return
        }
        reads.insert(mid)
        Task {
            async let config: Void = refreshConfig(mid)
            async let roots: Void = refreshRoots(mid)
            _ = await (config, roots)
            reads.remove(mid)
            if again.remove(mid) != nil { refreshFiles(mid) }
        }
    }

    /// Reads what machine `mid` lists, unless that is known; left unread, it is asked again next time.
    private func refreshConfig(_ mid: String) async {
        guard configs[mid] == nil else { return }
        do {
            configs[mid] = try await readProjects(open, mid: mid)
        } catch {
            logger.warning("could not read the projects listed on \(mid): \(error.msg)")
        }
    }

    /// Reads where machine `mid`'s recorded sessions ran: none where its hook never recorded one.
    private func refreshRoots(_ mid: String) async {
        do {
            let found = try await readFile(open, mid: mid, path: rootsPath, limit: rootsMax)
            if let bytes = found.bytes {
                recorded[mid] = parseRoots(String(decoding: bytes, as: UTF8.self))
            } else {
                logger.warning("the sessions recorded on \(mid) are too many to list: \(found.size)")
            }
        } catch where error.code == "not_found" || error.code == "bad_request" {
            recorded[mid] = [:]
        } catch {
            // The last read stands, so the projects stay as they were.
            logger.warning("could not read where the sessions recorded on \(mid) ran: \(error.msg)")
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "space")
