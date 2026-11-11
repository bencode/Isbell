// A turn of the conversation: what was asked on the right, what the agent said and did under it,
// then when it ended and how long it took; the last turn shows the agent at work instead. The day
// shows between turns on different days. As the Turn part of web/src/features/session/conversation.tsx.

import IsbellKit
import SwiftUI

private let names = ["claude": "Claude", "codex": "Codex", "pi": "pi"]

/// What a kind of agent is called in the chat.
func agentName(_ kind: String?) -> String {
    kind.map { names[$0] ?? $0 } ?? ""
}

struct TurnView: View {
    let turn: ChatTurn
    /// When the turn before it began, 0 for the first.
    let before: Int64
    let mid: String
    let kind: String?
    /// The agent works on this turn, since then.
    let working: UInt64?
    /// The agent asks, under this turn: it has not ended.
    let asking: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if turn.at > 0 && !sameDay(turn.at, before) { DayLine(at: turn.at) }
            if let you = turn.you { You(asked: you, mid: mid, at: turn.at) }
            if !turn.items.isEmpty || working != nil {
                AgentHead(name: agentName(kind), model: turn.model)
                ChatItems(items: turn.items, working: working != nil)
                if let working {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text("Working")
                        Elapsed(since: working)
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } else if !asking {
                    foot
                }
            }
        }
        .padding(.bottom, 16)
    }

    @ViewBuilder private var foot: some View {
        let at = turn.at > 0 ? Text(Date(milliseconds: turn.at), format: .dateTime.hour().minute()) : nil
        let took = turn.took.map { Text("took \(duration($0))") }
        if at != nil || took != nil {
            HStack(spacing: 4) {
                at
                if at != nil && took != nil { Text(verbatim: "·") }
                took
            }
            .font(.caption2.monospaced())
            .foregroundStyle(.tertiary)
        }
    }
}

private func sameDay(_ a: Int64, _ b: Int64) -> Bool {
    b > 0 && Calendar.current.isDate(Date(milliseconds: a), inSameDayAs: Date(milliseconds: b))
}

extension Date {
    init(milliseconds ms: Int64) { self.init(timeIntervalSince1970: Double(ms) / 1000) }
}

/// The day and time a turn began, across the chat.
private struct DayLine: View {
    let at: Int64

    var body: some View {
        let date = Date(milliseconds: at)
        HStack(spacing: 10) {
            line
            day(date) + Text(verbatim: " ") + Text(date, format: .dateTime.hour().minute())
            line
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .padding(.vertical, 6)
    }

    private func day(_ date: Date) -> Text {
        if Calendar.current.isDateInToday(date) { return Text("Today") }
        if Calendar.current.isDateInYesterday(date) { return Text("Yesterday") }
        return Text(date, format: .dateTime.month().day())
    }

    private var line: some View { Rectangle().fill(.separator).frame(height: 0.5) }
}

private struct AgentHead: View {
    let name: String
    let model: String?

    var body: some View {
        HStack(spacing: 7) {
            Text(verbatim: name.prefix(1).uppercased())
                .font(.caption2.monospaced().weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 18, height: 18)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 5))
            Text(verbatim: name).font(.footnote.weight(.semibold))
            if let model { Text(verbatim: modelName(model)).font(.caption).foregroundStyle(.tertiary) }
        }
    }
}

/// What was asked, on the right: its images, then its words, which a long press tells when they
/// were asked and copies.
struct You: View {
    let asked: Asked
    let mid: String
    /// Milliseconds since the epoch; 0 where the record does not tell.
    let at: Int64

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !asked.images.isEmpty || !asked.data.isEmpty { PromptImages(mid: mid, paths: asked.images, data: asked.data) }
            if !asked.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(verbatim: asked.text)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(Color.accentColor.opacity(0.14), in: bubble)
                    .contentShape(.contextMenuPreview, bubble)
                    .contextMenu {
                        if at > 0 {
                            Text(Date(milliseconds: at), format: .dateTime.month().day().hour().minute())
                        }
                        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = asked.text }
                    }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 48)
    }

    private var bubble: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 4, topTrailingRadius: 14)
    }
}
