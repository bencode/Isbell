// What an agent said and did in a turn: its words in Markdown, its thinking folded away, and its
// tool calls, those in a row sharing one box that folds to a line when nothing in it changed a file
// or went wrong. As web/src/features/session/chat-items.tsx.

import IsbellKit
import SwiftUI
import Textual

/// The items in order, tool calls that follow one another in one run.
private enum Run {
    case item(ChatItem)
    case tools([ToolItem])
}

private func runsOf(_ items: [ChatItem]) -> [Run] {
    items.reduce(into: []) { runs, item in
        guard case .tool(let tool) = item else { return runs.append(.item(item)) }
        if case .tools(let tools)? = runs.last {
            runs[runs.count - 1] = .tools(tools + [tool])
        } else {
            runs.append(.tools([tool]))
        }
    }
}

/// `working`: the agent is still at it, so a call without its result yet is the one running;
/// `asking`: the agent waits for leave, so that call is the one it asks about.
struct ChatItems: View {
    let items: [ChatItem]
    let working: Bool
    let asking: Bool

    var body: some View {
        // Items are only added at the end, so a run keeps its place.
        ForEach(Array(runsOf(items).enumerated()), id: \.offset) { _, run in
            switch run {
            case .tools(let tools): ToolRun(tools: tools, working: working, asking: asking)
            case .item(.text(let text)): ChatText(text: text)
            case .item(.thinking(let text, let ms)): Thinking(text: text, ms: ms)
            case .item(.note(let note, let text)): NoteLine(note: note, text: text)
            case .item(.tool): EmptyView()
            }
        }
    }
}

private struct ChatText: View {
    @Environment(\.chatPaths) private var paths
    let text: String

    var body: some View {
        Group {
            if let paths { StructuredText(text, parser: PathsMarkdown(paths: paths)) } else { StructuredText(markdown: text) }
        }
        .textual.textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A line that opens what it folds away.
private struct Fold<Label: View>: View {
    @Binding var open: Bool
    @ViewBuilder let label: Label

    var body: some View {
        Button {
            withAnimation(.snappy) { open.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .rotationEffect(.degrees(open ? 90 : 0))
                label
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

private struct Thinking: View {
    let text: String
    let ms: Int64?
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Fold(open: $open) {
                if let ms { Text("Thought for \(duration(ms))") } else { Text("Thinking") }
            }
            if open {
                Text(text)
                    .font(.callout.italic())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(.separator).frame(width: 2) }
            }
        }
    }
}

private struct NoteLine: View {
    let note: ChatNote
    let text: String?

    var body: some View {
        Group {
            switch note {
            case .interrupted: Text("Interrupted")
            case .failed: Text("Something went wrong") + Text(verbatim: text.map { " · \($0)" } ?? "")
            case .compacted: Text("Context compacted")
            }
        }
        .font(.footnote)
        .foregroundStyle(note == .failed ? AnyShapeStyle(Palette.danger) : AnyShapeStyle(.tertiary))
    }
}

/// A run of calls in a card: a line saying how many of each, which opens to the calls.
private struct ToolRun: View {
    let tools: [ToolItem]
    let working: Bool
    let asking: Bool
    // Calls that changed a file or went wrong are worth seeing, the rest fold away, as the run goes
    // on; once folded or opened by hand, it stays so.
    @State private var toggled: Bool?

    private var open: Bool {
        toggled ?? (tools.count == 1 || tools.contains { $0.edit != nil || $0.error })
    }

    var body: some View {
        let pending = tools.last.flatMap { $0.done ? nil : $0.id }
        VStack(spacing: 0) {
            if tools.count > 1 {
                Fold(open: Binding(get: { open }, set: { toggled = $0 })) {
                    Text("\(tools.count) tools")
                    Text(verbatim: counts.map { "\($0.name) \($0.n)" }.joined(separator: " · "))
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if open {
                ForEach(Array(tools.enumerated()), id: \.offset) { i, tool in
                    if i > 0 || tools.count > 1 { Divider().overlay(Palette.line) }
                    ToolRow(tool: tool, running: working && tool.id == pending, asked: asking && tool.id == pending)
                }
            }
        }
        .background(Palette.raised)
        .clipShape(.rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line, lineWidth: 0.5) }
    }

    /// How many calls of each tool, in the order first called.
    private var counts: [(name: String, n: Int)] {
        tools.reduce(into: [(name: String, n: Int)]()) { acc, tool in
            if let i = acc.firstIndex(where: { $0.name == tool.name }) { acc[i].n += 1 } else { acc.append((tool.name, 1)) }
        }
    }
}

private struct ToolRow: View {
    @Environment(\.chatPaths) private var paths
    @Environment(\.openURL) private var openURL
    let tool: ToolItem
    let running: Bool
    /// The call the agent asks leave for.
    let asked: Bool
    @State private var open = false

    /// A call on one file, such as an edit or a read, opens it.
    private var opens: URL? {
        guard let mention = paths?.whole(tool.target), !mention.dir else { return nil }
        return pathURL(mention)
    }

    var body: some View {
        let output = tool.output.flatMap { $0.isEmpty ? nil : $0 }
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Button {
                    withAnimation(.snappy) { open.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .rotationEffect(.degrees(open ? 90 : 0))
                            .opacity(output == nil ? 0 : 1)
                        Text(verbatim: tool.name)
                            .foregroundStyle(tool.error ? AnyShapeStyle(Palette.danger) : AnyShapeStyle(.secondary))
                            .frame(minWidth: 44, alignment: .leading)
                        Text(verbatim: tool.target).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 0)
                        if let edit = tool.edit {
                            (Text(verbatim: "+\(edit.add) ").foregroundStyle(Palette.ok) + Text(verbatim: "−\(edit.del)").foregroundStyle(Palette.danger))
                                .font(.caption2.monospaced())
                        }
                        if tool.error { Text("failed").font(.caption2.monospaced()).foregroundStyle(Palette.danger) }
                        if running { ProgressView().controlSize(.mini) }
                        if asked { Text("Waiting for you").font(.caption2.weight(.semibold)).foregroundStyle(Palette.warn) }
                    }
                    .font(.footnote)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(output == nil)
                if let opens {
                    Button("Open the file", systemImage: "doc.text") { openURL(opens) }
                        .labelStyle(.iconOnly)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 32)
                        .contentShape(.rect)
                }
            }
            if open, let output {
                ScrollView {
                    Text(verbatim: output)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                }
                .frame(maxHeight: 240)
                .background(Palette.raised2)
            }
        }
        .background(asked ? Palette.ask : .clear)
    }
}

/// As web/src/utils/time.ts `duration`: 12s, 4m 12s, 1h 3m.
func duration(_ ms: Int64) -> String {
    let s = max(0, Int((Double(ms) / 1000).rounded()))
    if s < 60 { return "\(s)s" }
    if s < 3600 { return "\(s / 60)m \(s % 60)s" }
    return "\(s / 3600)h \(s % 3600 / 60)m"
}
