// What a machine is and how loaded it is, as its gateway's `isbell.system` reads it
// (crates/isbell/src/gateway/system.rs). Facts a platform does not offer are nil. As
// web/src/model/system.ts.

import Foundation

/// Byte counts throughout; CPU usage is percent of all CPUs since the gateway's last read.
public struct System: Sendable, Equatable, Decodable {
    public struct CPU: Sendable, Equatable, Decodable {
        public var brand: String
        public var cores: Int?
        public var threads: Int
        public var arch: String
        public var usage: Double
    }

    public struct Load: Sendable, Equatable, Decodable {
        public var one: Double
        public var five: Double
        public var fifteen: Double
    }

    public struct Memory: Sendable, Equatable, Decodable {
        public var total: Int64
        public var used: Int64
        public var swapTotal: Int64
        public var swapUsed: Int64
    }

    /// The disk holding the home directory.
    public struct Disk: Sendable, Equatable, Decodable {
        public var mount: String
        public var total: Int64
        public var free: Int64
    }

    public var os: String?
    public var uptimeSecs: Int64?
    public var cpu: CPU
    public var load: Load?
    public var memory: Memory
    public var disk: Disk?
}

/// A read after a pause waits a moment for a second CPU sample.
private let systemTimeout: Duration = .seconds(10)

public func readSystem(_ call: Caller, mid: String) async throws(CallError) -> System {
    let result = try await call(mid, "isbell.system", .object([:]), systemTimeout)
    do {
        return try JSONDecoder().decode(System.self, from: Data(jsonText(result).utf8))
    } catch {
        throw CallError(code: "bad_response", msg: "unreadable system info: \(error)")
    }
}
