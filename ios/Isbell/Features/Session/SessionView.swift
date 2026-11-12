// A live session's page: its conversation as the agent records it, followed while the app is in
// front, and a reply bar under it; while the agent asks, what it waits on and where to answer
// instead. Looking at a finished session marks it read. As web/src/shell/mobile/chat.tsx and
// features/session/session-parts.tsx.

import IsbellKit
import SwiftUI
import os

struct SessionRoute: Hashable {
    let mid: String
    let paneId: String
}

struct SessionView: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.scenePhase) private var phase
    let route: SessionRoute
    @State private var model: ChatModel
    /// What is written to the agent and the files added for it, kept while it asks and the reply bar
    /// is away.
    @State private var draft = ""
    @State private var attachments: Attachments

    /// The record is followed again when the status changes, and only while the app is in front.
    private struct FollowKey: Hashable {
        let status: AgentStatus
        let since: UInt64
        let active: Bool
    }

    init(route: SessionRoute) {
        self.route = route
        _model = State(initialValue: ChatModel(mid: route.mid, paneId: route.paneId))
        _attachments = State(initialValue: Attachments(mid: route.mid))
    }

    var body: some View {
        let placed = store.projects.lazy
            .flatMap { p in p.sessions.map { Placed(session: $0, project: p) } }
            .first { $0.session.mid == route.mid && $0.session.paneId == route.paneId }
        Group {
            if let placed {
                content(placed)
            } else {
                ContentUnavailableView("This session has ended", systemImage: "checkmark.circle")
            }
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .top) { Reconnecting(status: store.space.status) }
        .navigationTitle(placed.map(placedTitle) ?? "")
        .navigationSubtitle(Text(verbatim: placed.map(placedWhere) ?? ""))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ placed: Placed) -> some View {
        let session = placed.session
        return Group {
            switch model.record {
            case .found where model.turns != nil:
                ChatList(model: model, session: session) {
                    if let kind = session.kind { model.earlier(store.space, kind: kind) }
                }
            case .unrecorded:
                ContentUnavailableView {
                    Label("No conversation recorded", systemImage: "text.bubble")
                } description: {
                    Text("What is said shows here once the agent records it. If its terminal has a conversation that never shows here, its record can't be found (start Codex with --no-daemon).")
                }
            case .unreadable:
                ContentUnavailableView("The record can't be read", systemImage: "doc.questionmark",
                                       description: Text("It is gone, or too large."))
            case .finding, .found:
                VStack(spacing: 12) {
                    ProgressView("Reading its record…")
                    if let error = model.error { Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            if session.status == .blocked {
                AskingDock(session: session)
            } else {
                ReplyBar(session: session, draft: $draft, attachments: attachments) { model.didSend($0) }
            }
        }
        .task(id: FollowKey(status: session.status, since: session.statusSince, active: phase == .active)) {
            guard phase == .active else { return }
            if session.status == .done { store.prefs.markSeen(session.id, at: session.statusSince) }
            await model.follow(store.space, session: session, project: placed.project)
        }
    }
}

/// While the relay connection is down: what is read stays, and nothing new comes until it is back.
private struct Reconnecting: View {
    let status: ConnStatus

    var body: some View {
        if status == .connecting || status == .reconnecting {
            Label {
                Text(status == .connecting ? "Connecting…" : "Reconnecting…")
            } icon: {
                ProgressView().controlSize(.mini)
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.bar, in: .capsule)
            .padding(.top, 4)
        }
    }
}

/// What the agent asks leave for, read once it asks; it is answered in its terminal.
private struct AskingDock: View {
    @Environment(SpaceStore.self) private var store
    let session: Session
    @State private var asking: ToolUse?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text("\(session.name) is asking you")
            } icon: {
                Circle().fill(.orange).frame(width: 7, height: 7)
            }
            .font(.subheadline.weight(.semibold))
            if let asking {
                ScrollView {
                    Text(verbatim: toolLine(asking))
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 110)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 8))
            }
            Text("Answer it in its terminal").font(.footnote).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
        .task(id: session.statusSince) {
            do throws(CallError) {
                asking = try await agentNote(store.call, mid: session.mid, paneId: session.paneId).asking
            } catch {
                // The dock still says where to answer.
                logger.warning("could not read what \(session.paneId) asks: \(error.msg)")
            }
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "session")
