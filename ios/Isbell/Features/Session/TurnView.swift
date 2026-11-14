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

/// The mark of a kind of agent: Claude's orange, Codex's ink, any other the accent.
private func markColors(_ kind: String?) -> (fill: Color, ink: Color) {
    switch kind {
    case "claude": (Color(hex: 0xd97757), .white)
    case "codex": (.primary, Palette.bg)
    default: (Palette.accent, Palette.bg)
    }
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
                AgentHead(kind: kind, model: turn.model)
                ChatItems(items: turn.items, working: working != nil, asking: asking)
                if let working {
                    HStack(spacing: 6) {
                        StatusDot(status: .working)
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

/// A label across the chat, between dashed lines.
struct Divided<Label: View>: View {
    @ViewBuilder let label: Label

    var body: some View {
        HStack(spacing: 10) {
            line
            label
            line
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .padding(.vertical, 6)
    }

    private var line: some View {
        Line().stroke(Palette.line, style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(height: 1)
    }
}

private nonisolated struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        Path { $0.move(to: CGPoint(x: 0, y: rect.midY)); $0.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) }
    }
}

/// The day and time a turn began, across the chat.
private struct DayLine: View {
    let at: Int64

    var body: some View {
        let date = Date(milliseconds: at)
        Divided { Text("\(day(date)) \(date, format: .dateTime.hour().minute())") }
    }

    private func day(_ date: Date) -> Text {
        if Calendar.current.isDateInToday(date) { return Text("Today") }
        if Calendar.current.isDateInYesterday(date) { return Text("Yesterday") }
        return Text(date, format: .dateTime.month().day())
    }
}

/// Who answers: the agent's mark, name and model.
private struct AgentHead: View {
    let kind: String?
    let model: String?

    var body: some View {
        let name = agentName(kind)
        let mark = markColors(kind)
        HStack(spacing: 7) {
            Text(verbatim: name.prefix(1).uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(mark.ink)
                .frame(width: 20, height: 20)
                .background(mark.fill, in: .rect(cornerRadius: 6))
            Text(verbatim: name).font(.footnote.weight(.semibold))
            if let model { Text(verbatim: modelName(model)).font(.caption).foregroundStyle(.tertiary) }
        }
    }
}

/// What was asked, on the right: its images, then its words, which a long press tells when they
/// were asked and copies.
struct You: View {
    @Environment(\.chatPaths) private var paths
    let asked: Asked
    let mid: String
    /// Milliseconds since the epoch; 0 where the record does not tell.
    let at: Int64

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !asked.images.isEmpty || !asked.data.isEmpty { PromptImages(mid: mid, paths: asked.images, data: asked.data) }
            if !asked.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(paths?.linked(asked.text) ?? AttributedString(asked.text))
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(Palette.raised2, in: bubble)
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
        UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18)
    }
}
