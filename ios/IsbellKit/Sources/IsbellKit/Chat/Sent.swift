// What was sent to an agent and shows at once, until its record has it. As unrecorded in
// web/src/features/session/use-chat-follow.ts.

/// The record's last turn when something was sent.
public enum SentAfter: Sendable, Equatable {
    /// The record was not read yet.
    case notRead
    /// It was read, with no turn yet.
    case start
    case turn(String)
}

public struct Sent: Sendable, Equatable {
    public var text: String
    /// Milliseconds since the epoch; tells one sent from another.
    public var at: Int64
    public var after: SentAfter

    public init(text: String, at: Int64, after: SentAfter) {
        self.text = text
        self.at = at
        self.after = after
    }
}

/// What was sent that the record does not have yet, in order. Each takes a turn asking after the one
/// last when it was sent, the one asking the same first; without a turn to tell by, only that one.
public func unrecorded(_ sent: [Sent], turns: [ChatTurn]?) -> [Sent] {
    let turns = turns ?? []
    var used = Set<String>()
    return sent.filter { s in
        // A turn no longer read, as in another record, leaves the whole record to look in.
        let from = if case .turn(let id) = s.after { (turns.firstIndex { $0.id == id } ?? -1) + 1 } else { 0 }
        let asked = turns[from...].filter { $0.you != nil && !used.contains($0.id) }
        let said = splitUploads(s.text).text
        let it = asked.first { $0.you?.text.trimmingCharacters(in: .whitespacesAndNewlines) == said }
            ?? (s.after == .notRead ? nil : asked.first)
        if let it { used.insert(it.id) }
        return it == nil
    }
}
