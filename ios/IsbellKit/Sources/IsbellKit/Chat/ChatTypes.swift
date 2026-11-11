// A session's conversation as the agent recorded it, read into turns: what was asked, then what
// the agent said, thought and did, in order. As web/src/model/chat/types.ts.

import Foundation

/// Lines an edit added and removed.
public struct EditCount: Sendable, Equatable {
    public var add: Int
    public var del: Int

    public init(add: Int, del: Int) {
        self.add = add
        self.del = del
    }
}

public struct ToolItem: Sendable, Equatable {
    public var id: String
    /// By Claude Code's names (Bash, Read, Edit, …), whichever agent ran it.
    public var name: String
    public var target: String
    public var output: String?
    public var error: Bool
    public var edit: EditCount?
    /// Its result is in.
    public var done: Bool

    public init(id: String, name: String, target: String, output: String? = nil, error: Bool,
                edit: EditCount? = nil, done: Bool) {
        self.id = id
        self.name = name
        self.target = target
        self.output = output
        self.error = error
        self.edit = edit
        self.done = done
    }
}

public enum ChatNote: String, Sendable {
    case interrupted, failed, compacted
}

public enum ChatItem: Sendable, Equatable {
    case text(String)
    /// `ms`: how long it thought, where the record tells.
    case thinking(String, ms: Int64?)
    case tool(ToolItem)
    case note(ChatNote, text: String?)
}

/// What was asked: its words, the images sent along by path, and those sent as data URLs.
public struct Asked: Sendable, Equatable {
    public var text: String
    public var images: [String]
    public var data: [String]

    public init(text: String, images: [String] = [], data: [String] = []) {
        self.text = text
        self.images = images
        self.data = data
    }
}

public struct ChatTurn: Sendable, Equatable, Identifiable {
    public var id: String
    /// Nil for what came before the first question.
    public var you: Asked?
    /// Milliseconds since the epoch; 0 where the record does not tell.
    public var at: Int64
    public var took: Int64?
    public var model: String?
    public var items: [ChatItem]
}

/// What each agent's record is read into, in its order, before it is told into turns.
enum Entry: Equatable {
    case you(id: String, at: Int64, Asked)
    case item(at: Int64, ChatItem)
    case result(id: String, output: String, error: Bool)
    case end(took: Int64?)
    case model(String)
}

// MARK: - Reading records

/// The value as a string, or "" for anything else.
func text(_ value: JSON?) -> String { value?.string ?? "" }

/// The objects in an array, or none.
func objects(_ value: JSON?) -> [JSON] {
    guard case .array(let items)? = value else { return [] }
    return items.filter { if case .object = $0 { true } else { false } }
}

func isObject(_ value: JSON?) -> Bool {
    if case .object? = value { true } else { false }
}

func number(_ value: JSON?) -> Int64? {
    switch value {
    case .int(let n)?: n
    case .double(let n)? where n.isFinite: Int64(n)
    default: nil
    }
}

/// Milliseconds since the epoch of an ISO 8601 time, or 0, as `Date.parse(…) || 0`.
func isoTime(_ value: JSON?) -> Int64 {
    guard let s = value?.string else { return 0 }
    // Whether a time has fractional seconds varies; one that parses neither way counts as untold.
    let date = (try? Date(s, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
        ?? (try? Date(s, strategy: Date.ISO8601FormatStyle()))
    return date.map { Int64(($0.timeIntervalSince1970 * 1000).rounded()) } ?? 0
}
