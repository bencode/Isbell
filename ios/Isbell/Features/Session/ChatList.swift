// The turns read, from where they begin, then what was sent that the record does not have yet: it
// opens at the end and stays there as the agent adds to it, unless scrolled up, when a pill says
// there is more below; what is sent goes to the end. Reading earlier turns keeps the turn in view
// where it was. Dragging the turns down takes the keyboard with them. As
// web/src/features/session/use-chat-follow.ts and conversation.tsx.

import IsbellKit
import SwiftUI

struct ChatList: View {
    let model: ChatModel
    let session: Session
    let earlier: () -> Void
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var atEnd = true
    @State private var more = false
    /// The turn in view as earlier ones are read, to keep in view after.
    @State private var kept: String?

    var body: some View {
        let turns = model.turns ?? []
        ScrollView {
            // Not lazy: opening at the end of estimated heights can land past the content.
            VStack(alignment: .leading, spacing: 0) {
                top(turns)
                ForEach(Array(turns.enumerated()), id: \.element.id) { i, turn in
                    let last = i == turns.count - 1
                    TurnView(turn: turn, before: i > 0 ? turns[i - 1].at : 0, mid: session.mid, kind: session.kind,
                             working: last && session.status == .working ? session.statusSince : nil,
                             asking: last && session.status == .blocked)
                }
                ForEach(model.pending, id: \.at) { sent in
                    VStack(alignment: .trailing, spacing: 6) {
                        You(asked: sent.asked, mid: session.mid, at: sent.at).opacity(0.75)
                        Text("Sent · waiting for the record").font(.caption2.monospaced()).foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.bottom, 16)
                }
                if let error = model.error {
                    Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(16)
            // As wide as the screen: a code block or a long line scrolls on its own.
            .containerRelativeFrame(.horizontal)
            .scrollTargetLayout()
        }
        .scrollPosition($position)
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .onScrollGeometryChange(for: Bool.self) { $0.visibleRect.maxY >= $0.contentSize.height - 24 } action: { _, end in
            atEnd = end
            if end { more = false }
        }
        .onChange(of: model.end) { was, _ in
            // The first read opens at the end by itself.
            guard was > 0 else { return }
            if atEnd {
                withAnimation { position.scrollTo(edge: .bottom) }
            } else {
                more = true
            }
        }
        .onChange(of: model.pending.count) { was, now in
            // Just sent: to see it go in.
            if now > was { withAnimation { position.scrollTo(edge: .bottom) } }
        }
        .onChange(of: turns.first?.id) {
            guard let kept else { return }
            position.scrollTo(id: kept, anchor: .top)
            self.kept = nil
        }
        .overlay(alignment: .bottom) {
            if more {
                Button {
                    withAnimation { position.scrollTo(edge: .bottom) }
                } label: {
                    Label("New below", systemImage: "arrow.down").font(.footnote.weight(.medium))
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .padding(.bottom, 10)
            }
        }
    }

    /// Where the turns read begin: the session's start, or a button reading the turns before.
    @ViewBuilder private func top(_ turns: [ChatTurn]) -> some View {
        Group {
            if model.atStart {
                Text("Start of the session")
            } else {
                Button {
                    // A turn cut at its start is read whole with the part before, under another id.
                    kept = turns.first { $0.you != nil }?.id
                    earlier()
                } label: {
                    Text(model.paging ? "Reading earlier turns…" : "Show earlier turns")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .disabled(model.paging)
            }
        }
        .font(.caption)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity)
        .padding(.bottom, 18)
    }
}
