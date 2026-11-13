// A live session in a list, opening its page: a card for one that asks, has finished or works, a
// line for one standing by. A card reads what herdr knows of its agent: once for each status, and
// every 5 s while it works.
// As web/src/shell/mobile/card.tsx and features/session/use-agent-note.ts.

import IsbellKit
import SwiftUI
import os

struct SessionCard: View {
    @Environment(SpaceStore.self) private var store
    let placed: Placed
    /// The first line: where it runs, short of what the screen already says.
    let place: String
    @State private var read: NoteRead?

    private struct NoteRead {
        let since: UInt64
        let note: AgentNote
    }

    /// A note is read again when the status changes, and what was read under one is not shown under the next.
    private struct NoteKey: Hashable {
        let id: String
        let status: AgentStatus
        let since: UInt64
    }

    private var session: Session { placed.session }
    private var note: AgentNote? { read?.since == session.statusSince ? read?.note : nil }

    var body: some View {
        NavigationLink(value: SessionRoute(mid: session.mid, paneId: session.paneId)) { card }
            .buttonStyle(.plain)
            .contentShape(.contextMenuPreview, .rect(cornerRadius: 12))
            .contextMenu { SessionMenu(placed: placed) }
            .task(id: NoteKey(id: session.id, status: session.status, since: session.statusSince)) {
                await readNotes()
            }
    }

    private var card: some View {
        let asking = session.status == .blocked
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                StatusDot(status: session.status)
                Text(place).lineLimit(1)
                Spacer(minLength: 8)
                Elapsed(since: session.statusSince).font(.caption.monospaced()).foregroundStyle(.tertiary)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            Text(placedTitle(placed))
                .font(.callout.weight(.semibold))
                .lineLimit(2)
            noteLine
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(asking ? Palette.ask : Palette.raised,
                    in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(asking ? Palette.askLine : Palette.line, lineWidth: 0.5)
        }
        .contentShape(.rect(cornerRadius: 12))
    }

    /// The tool it waits on or is using, or what it was asked once it finished.
    @ViewBuilder private var noteLine: some View {
        switch session.status {
        case .blocked:
            if let asking = note?.asking {
                toolText(asking)
            } else {
                Text("Waiting for your answer").font(.footnote).foregroundStyle(.secondary)
            }
        case .working:
            if let doing = note?.doing { toolText(doing) }
        case .done:
            if let asked = note?.asked {
                Text(asked).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
        case .idle, .unknown:
            EmptyView()
        }
    }

    private func toolText(_ use: ToolUse) -> some View {
        Text(toolLine(use)).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
    }

    private func readNotes() async {
        let target = session
        while true {
            do {
                read = NoteRead(since: target.statusSince, note: try await agentNote(store.call, mid: target.mid, paneId: target.paneId))
            } catch {
                // The note only adds to the card: the last one stays.
                logger.warning("could not read what herdr knows of \(target.paneId): \(error.msg)")
            }
            guard target.status == .working, await pause(.seconds(5)) else { return }
        }
    }
}

/// A session standing by, in a line.
struct StandingRow: View {
    let placed: Placed

    var body: some View {
        NavigationLink(value: SessionRoute(mid: placed.session.mid, paneId: placed.session.paneId)) { row }
            .buttonStyle(.plain)
            .contextMenu { SessionMenu(placed: placed) }
    }

    private var row: some View {
        HStack(spacing: 8) {
            StatusDot(status: placed.session.status)
            VStack(alignment: .leading, spacing: 1) {
                Text(placedTitle(placed)).lineLimit(1)
                Text(placedWhere(placed)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Elapsed(since: placed.session.statusSince).font(.caption2.monospaced()).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
    }
}

struct StatusDot: View {
    let status: AgentStatus

    var body: some View {
        Group {
            switch status {
            case .blocked: Circle().fill(Palette.warn)
            case .done: Circle().fill(Palette.ok)
            case .working: Circle().fill(Palette.accent)
            case .idle, .unknown: Circle().strokeBorder(.secondary, lineWidth: 1.5)
            }
        }
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)
    }
}

/// How long ago, by the gateway's clock, refreshed every 30 s.
struct Elapsed: View {
    let since: UInt64

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Text(verbatim: elapsed(since, now: context.date))
        }
    }
}

/// As web/src/utils/time.ts `since`: 3s, 1m, 2h, 4d.
func elapsed(_ ms: UInt64, now: Date) -> String {
    let s = max(0, Int((now.timeIntervalSince1970 * 1000 - Double(ms)) / 1000))
    if s < 60 { return "\(s)s" }
    if s < 3600 { return "\(s / 60)m" }
    if s < 86_400 { return "\(s / 3600)h" }
    return "\(s / 86_400)d"
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "card")
