// JSON values, and a writer that puts out the bytes serde_json and JSON.stringify do. Foundation's
// JSONEncoder does not keep the order of keys, and frames must match the other ends byte for byte.

import Foundation

public enum JSON: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let v = try? c.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? c.decode(Int64.self) {
            self = .int(v)
        } else if let v = try? c.decode(Double.self) {
            self = .double(v)
        } else if let v = try? c.decode(String.self) {
            self = .string(v)
        } else if let v = try? c.decode([JSON].self) {
            self = .array(v)
        } else {
            self = .object(try c.decode([String: JSON].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    subscript(key: String) -> JSON? {
        if case .object(let fields) = self { fields[key] } else { nil }
    }

    var string: String? {
        if case .string(let v) = self { v } else { nil }
    }

    var bool: Bool? {
        if case .bool(let v) = self { v } else { nil }
    }

    var uint: UInt64? {
        if case .int(let v) = self, v >= 0 { UInt64(v) } else { nil }
    }
}

/// No spaces; objects not written field by field have their keys sorted.
func jsonText(_ value: JSON) -> String {
    switch value {
    case .null: "null"
    case .bool(let v): v ? "true" : "false"
    case .int(let v): String(v)
    case .double(let v): doubleText(v)
    case .string(let v): stringText(v)
    case .array(let items): "[" + items.map(jsonText).joined(separator: ",") + "]"
    case .object(let fields): objectText(fields.sorted { $0.key < $1.key }.map { ($0.key, jsonText($0.value)) })
    }
}

/// An object whose keys keep the given order, from values already written; nil fields are left out.
func objectText(_ fields: [(String, String?)]) -> String {
    "{" + fields.compactMap { key, value in value.map { stringText(key) + ":" + $0 } }.joined(separator: ",") + "}"
}

private func doubleText(_ v: Double) -> String {
    if let exact = Int64(exactly: v) { return String(exact) }
    return v.isFinite ? "\(v)" : "null"
}

private func stringText(_ s: String) -> String {
    var out = "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case _ where u.value < 0x20:
            out += String(format: "\\u%04x", u.value)
        default: out.unicodeScalars.append(u)
        }
    }
    out += "\""
    return out
}
