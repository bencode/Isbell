// What a gateway publishes about its machine, as crates/isbell-proto/src/state.rs defines it.

import Foundation
import os

public struct MachineInfo: Sendable, Equatable, Decodable {
    public var id: String
    public var name: String
    public var hostname: String
    public var os: String
    public var version: String
}

public enum HerdrStatus: String, Sendable, Decodable {
    case ready, unavailable, incompatible, unknown

    public init(from decoder: any Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct HerdrState: Sendable, Equatable, Decodable {
    public var status: HerdrStatus
    public var version: String?
    public var `protocol`: UInt32?
}

public struct Caps: Sendable, Equatable, Decodable {
    public var methods: [String]
    public var agentKinds: [String]
}

public enum AgentStatus: String, Sendable, Decodable {
    case idle, working, blocked, done, unknown

    public init(from decoder: any Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct Agent: Sendable, Equatable, Decodable {
    public var paneId: String
    public var name: String?
    public var kind: String?
    public var status: AgentStatus
    /// Milliseconds on the gateway's clock.
    public var statusSince: UInt64
    public var cwd: String?
    public var title: String?
}

public struct MachineState: Sendable, Equatable, Decodable {
    public var machine: MachineInfo
    /// The gateway process: a higher boot means it restarted.
    public var boot: UInt64
    public var rev: UInt64
    public var herdr: HerdrState
    public var caps: Caps
    public var agents: [Agent]

    /// A state from the relay, if it has the shape this client reads.
    public static func read(_ value: JSON) -> MachineState? {
        do {
            return try JSONDecoder().decode(MachineState.self, from: Data(jsonText(value).utf8))
        } catch {
            logger.warning("ignoring unreadable machine state: \(error)")
            return nil
        }
    }
}

public func isNewer(_ a: MachineState, than b: MachineState) -> Bool {
    a.boot > b.boot || (a.boot == b.boot && a.rev > b.rev)
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "state")
