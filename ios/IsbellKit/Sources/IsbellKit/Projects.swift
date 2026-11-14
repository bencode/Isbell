// A machine's projects are the directories it lists (ProjectConfig); until it lists any, the roots of
// the directories where an agent or a shell is running, or where Isbell's hook recorded a session. A
// directory's root is the git repository it is in, or the directory itself when it is in none; only
// the pane's own directory decides. A pane outside everything listed stands in a project of its own,
// not listed. As web/src/model/projects.ts and agent-name.ts.

import Foundation

public struct Session: Sendable, Equatable, Identifiable {
    public var mid: String
    public var paneId: String
    /// What it is called on screen; see `shownName`.
    public var name: String
    /// Its name in herdr, when it has one.
    public var herdrName: String?
    public var kind: String?
    public var status: AgentStatus
    /// Milliseconds on the gateway's clock.
    public var statusSince: UInt64
    /// The task its terminal's title names, as last pulled.
    public var title: String?
    public var unread: Bool
    /// Where the agent works, when it said.
    public var cwd: String?

    public var id: String { paneKey(mid, paneId) }
}

public struct Project: Sendable, Equatable, Identifiable {
    public var mid: String
    public var machine: String
    public var online: Bool
    public var path: String
    /// `path` with the machine's home shown as `~`.
    public var display: String
    public var name: String
    /// One of the machine's projects, rather than a directory where something happens to run. Where
    /// a machine lists none yet, those with something running count.
    public var configured: Bool
    public var sessions: [Session]
    public var shells: [Shell]
    /// When a session recorded in it was last active, if any was.
    public var updated: Int64?

    public var id: String { dirKey(mid, path) }
    public var hasPanes: Bool { !sessions.isEmpty || !shells.isEmpty }
}

/// When each session was last looked at: its statusSince at the time, by `Session.id`.
public typealias Seen = [String: UInt64]

func paneKey(_ mid: String, _ paneId: String) -> String { "\(mid)/\(paneId)" }
/// A directory on a machine, as the repositories found for directories are kept.
func dirKey(_ mid: String, _ dir: String) -> String { "\(mid):\(dir)" }

/// The home directory as it shows in a machine's paths, if any does.
public func homeOf(_ paths: [String]) -> String? {
    paths.lazy.compactMap { $0.prefixMatch(of: /\/(?:Users|home)\/[^\/]+/).map { String($0.output) } }.first
}

public func trimSlash(_ path: String) -> String {
    guard path.count > 1 else { return path }
    var trimmed = Substring(path)
    while trimmed.hasSuffix("/") { trimmed = trimmed.dropLast() }
    return String(trimmed)
}

/// `path` with the home directory written `~`.
public func tildify(_ path: String, home: String?) -> String {
    guard let home, path == home || path.hasPrefix("\(home)/") else { return path }
    return "~" + path.dropFirst(home.count)
}

/// The deepest of `listed` that holds `dir`, if any does.
private func holder(of dir: String, in listed: [String]) -> String? {
    listed.filter { dir == $0 || dir.hasPrefix("\($0)/") }.max { $0.count < $1.count }
}

/// A pane id as short as it reads: 'w1A:p1' → '1A', 'w1A:p2' → '1A:2'; anything else as it is.
func shortPane(_ paneId: String) -> String {
    guard let m = paneId.wholeMatch(of: /w([^:]+):p(\d+)/) else { return paneId }
    return m.2 == "1" ? String(m.1) : "\(m.1):\(m.2)"
}

/// What an agent is called on screen: its herdr name, else its kind and short pane.
public func shownName(_ name: String?, kind: String?, paneId: String) -> String {
    name ?? "\(kind ?? "agent") · \(shortPane(paneId))"
}

/// Ordered by machine, so the projects of a machine stand together; then those it lists, as it
/// lists them; then those with panes by name; then the rest, the last active first.
/// `recorded`: the roots of each machine's recorded sessions. `listed`: the directories of each
/// machine that lists its projects. `titles`: the task of each agent's pane, by machine and pane.
public func deriveProjects(
    _ machines: [MachineEntry], shells: [Shell], seen: Seen, repos: [String: String],
    recorded: [String: Roots] = [:], listed: [String: [String]] = [:], titles: [String: [String: String]] = [:]
) -> [Project] {
    machines
        .flatMap { entry in projects(of: entry, shells: shells, seen: seen, repos: repos,
                                     kept: recorded[entry.id] ?? [:], paths: listed[entry.id],
                                     titles: titles[entry.id] ?? [:]) }
        .sorted { before($0, $1, listed: listed) }
}

private func projects(
    of entry: MachineEntry, shells: [Shell], seen: Seen, repos: [String: String],
    kept: Roots, paths: [String]?, titles: [String: String]
) -> [Project] {
    let state = entry.state
    let mid = entry.id
    // A directory listed may be inside a repository, or hold it: a pane's own directory goes first.
    let rootOf = { (cwd: String?) -> String in
        guard let cwd, !cwd.isEmpty else { return "" }
        let dir = trimSlash(cwd)
        let root = repos[dirKey(mid, cwd)] ?? dir
        return paths.flatMap { holder(of: dir, in: $0) ?? holder(of: root, in: $0) } ?? root
    }
    let agents = state.agents.map { (agent: $0, root: rootOf($0.cwd)) }
    let mine = shells.filter { $0.mid == mid }.map { shell in
        var trimmed = shell
        trimmed.cwd = trimSlash(shell.cwd)
        return (shell: trimmed, root: rootOf(shell.cwd))
    }
    let running = agents.map(\.root) + mine.map(\.root)
    var seenRoots = Set<String>()
    let roots = (running + (paths ?? Array(kept.keys))).filter { seenRoots.insert($0).inserted }
    let home = homeOf(roots)
    return roots.map { path in
        Project(
            mid: mid,
            machine: state.machine.name,
            online: entry.online,
            path: path,
            display: path.isEmpty ? "?" : tildify(path, home: home),
            name: path.split(separator: "/").last.map(String.init) ?? (path.isEmpty ? state.machine.name : "/"),
            configured: (paths ?? running).contains(path),
            sessions: agents.filter { $0.root == path }.map { session($0.agent, mid: mid, seen: seen, title: titles[$0.agent.paneId]) },
            shells: mine.filter { $0.root == path }.map(\.shell),
            updated: kept[path]?.updated)
    }
}

private func session(_ a: Agent, mid: String, seen: Seen, title: String?) -> Session {
    let cwd = trimSlash(a.cwd ?? "")
    return Session(
        mid: mid,
        paneId: a.paneId,
        name: shownName(a.name, kind: a.kind, paneId: a.paneId),
        herdrName: a.name,
        kind: a.kind,
        status: a.status,
        statusSince: a.statusSince,
        title: title,
        unread: a.status == .done && a.statusSince > (seen[paneKey(mid, a.paneId)] ?? 0),
        cwd: cwd.isEmpty ? nil : cwd)
}

private func before(_ a: Project, _ b: Project, listed: [String: [String]]) -> Bool {
    let rank = { (p: Project) in listed[p.mid]?.firstIndex(of: p.path) ?? Int.max }
    let order = [
        text(a.machine, b.machine),
        text(a.mid, b.mid),
        number(rank(a), rank(b)),
        number(b.hasPanes ? 1 : 0, a.hasPanes ? 1 : 0),
        a.hasPanes ? 0 : number(b.updated ?? 0, a.updated ?? 0),
        text(a.name, b.name),
        text(a.path, b.path),
    ]
    return (order.first { $0 != 0 } ?? 0) < 0
}

private func text(_ a: String, _ b: String) -> Int {
    switch a.localizedCompare(b) {
    case .orderedAscending: -1
    case .orderedDescending: 1
    case .orderedSame: 0
    }
}

private func number<T: Comparable>(_ a: T, _ b: T) -> Int { a < b ? -1 : a > b ? 1 : 0 }

/// A session with the project it runs in.
public struct Placed: Sendable, Equatable, Identifiable {
    public var session: Session
    public var project: Project
    public var id: String { session.id }

    public init(session: Session, project: Project) {
        self.session = session
        self.project = project
    }
}

/// What a session is at, once its agent has said, else its name.
public func placedTitle(_ p: Placed) -> String { p.session.title ?? p.session.name }

/// Which project, machine and agent a session is, in a line.
public func placedWhere(_ p: Placed) -> String {
    [p.project.configured ? p.project.name : p.project.display, p.project.machine, p.session.kind ?? ""]
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
}

/// The agents on machines that are online, by what they are doing; each is in exactly one lane.
public struct Lanes: Sendable, Equatable {
    public var asking: [Placed]
    public var finished: [Placed]
    public var running: [Placed]
    /// The rest: read, idle, or of unknown status.
    public var standing: [Placed]
}

/// The lanes that wait on you list the longest waiting first; the ones standing, the latest.
public func lanes(_ projects: [Project]) -> Lanes {
    let live = projects
        .filter(\.online)
        .flatMap { project in project.sessions.map { Placed(session: $0, project: project) } }
        .sorted { $0.session.statusSince < $1.session.statusSince }
    let status = { (p: Placed) in p.session.status }
    return Lanes(
        asking: live.filter { status($0) == .blocked },
        finished: live.filter { status($0) == .done && $0.session.unread },
        running: live.filter { status($0) == .working },
        standing: live.filter {
            (status($0) == .done && !$0.session.unread) || status($0) == .idle || status($0) == .unknown
        }.reversed())
}
