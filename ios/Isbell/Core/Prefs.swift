// What this iPhone remembers between launches: when sessions were looked at, the projects each
// machine last listed, what was last started where, and how the screens were left. In UserDefaults;
// what cannot be read back starts over.

import Foundation
import IsbellKit
import Observation
import SwiftUI
import os

enum Theme: String, CaseIterable {
    case system, light, dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

@Observable
final class Prefs {
    /// When each session was last looked at; written once sessions open.
    private(set) var seen: Seen
    /// The directories each machine last listed, shown until it is read again.
    private(set) var keptPaths: [String: [String]]
    /// Whether the sessions standing by are shown.
    var idleOpen: Bool { didSet { defaults.set(idleOpen, forKey: Key.idleOpen) } }
    var theme: Theme { didSet { defaults.set(theme.rawValue, forKey: Key.theme) } }
    /// The projects started in lately, the latest first: `Project.id`s, three at most.
    private(set) var recentProjects: [String]
    /// The kind of agent last started.
    private(set) var lastAgent: String?

    @ObservationIgnored private let defaults: UserDefaults

    private enum Key {
        static let seen = "seen"
        static let keptPaths = "keptPaths"
        static let idleOpen = "idleOpen"
        static let theme = "theme"
        static let recentProjects = "recentProjects"
        static let lastAgent = "lastAgent"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        seen = Self.decoded(defaults, Key.seen) ?? [:]
        keptPaths = Self.decoded(defaults, Key.keptPaths) ?? [:]
        idleOpen = defaults.bool(forKey: Key.idleOpen)
        theme = defaults.string(forKey: Key.theme).flatMap(Theme.init) ?? .system
        recentProjects = defaults.stringArray(forKey: Key.recentProjects) ?? []
        lastAgent = defaults.string(forKey: Key.lastAgent)
    }

    /// Session `id` is looked at under the status it has had since `since`.
    func markSeen(_ id: String, at since: UInt64) {
        guard seen[id] != since else { return }
        seen[id] = since
        save(seen, Key.seen)
    }

    func keep(_ listed: [String: [String]]) {
        guard listed != keptPaths else { return }
        keptPaths = listed
        save(listed, Key.keptPaths)
    }

    /// Started `agent` in project `project` (a `Project.id`).
    func used(project: String, agent: String) {
        recentProjects = Array(([project] + recentProjects.filter { $0 != project }).prefix(3))
        lastAgent = agent
        defaults.set(recentProjects, forKey: Key.recentProjects)
        defaults.set(agent, forKey: Key.lastAgent)
    }

    /// Forgets what belonged to the space left; how the screens look, and the agent liked, stay.
    func clearSpace() {
        seen = [:]
        keptPaths = [:]
        recentProjects = []
        defaults.removeObject(forKey: Key.seen)
        defaults.removeObject(forKey: Key.keptPaths)
        defaults.removeObject(forKey: Key.recentProjects)
    }

    private func save<T: Encodable>(_ value: T, _ key: String) {
        do {
            defaults.set(try JSONEncoder().encode(value), forKey: key)
        } catch {
            logger.error("could not keep \(key): \(error)")
        }
    }

    private static func decoded<T: Decodable>(_ defaults: UserDefaults, _ key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            logger.error("could not read back \(key): \(error)")
            return nil
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "prefs")
