// A live session's page: its conversation as the agent records it, followed while the app is in
// front, and a reply bar under it; while the agent asks, what it waits on and its terminal to answer
// in instead. Its terminal opens full screen from the menu. Looking at a finished session marks it
// read. As web/src/shell/mobile/chat.tsx and features/session/session-parts.tsx.

import IsbellKit
import SwiftUI
import os

struct SessionRoute: Hashable {
    let mid: String
    let paneId: String
    /// Just started: until its agent is made out, the pane is not a session yet.
    var starting = false
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
    /// What is being said to the agent, which lands in the draft.
    @State private var voice = VoiceInput()
    /// Whether its terminal is open, full screen.
    @State private var terminal = false

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
                    .toolbar {
                        Menu("More", systemImage: "ellipsis.circle") {
                            Button("Terminal", systemImage: "apple.terminal") { terminal = true }
                        }
                    }
                    .fullScreenCover(isPresented: $terminal) { TerminalScreen(placed: placed) }
            } else if route.starting {
                ProgressView("Starting…")
            } else {
                ContentUnavailableView("This session has ended", systemImage: "checkmark.circle")
            }
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .top) { Reconnecting(status: store.space.status) }
        .navigationTitle(placed.map(placedTitle) ?? "")
        .navigationSubtitle(Text(verbatim: placed.map(placedWhere) ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        // A recording left behind is dropped; iOS would cut it off in the background anyway.
        .onDisappear { voice.discard() }
        .onChange(of: phase) { _, now in
            if now == .background { voice.discard() }
        }
    }

    private func content(_ placed: Placed) -> some View {
        let session = placed.session
        return Group {
            switch model.record {
            case .found where model.turns != nil:
                ChatList(model: model, mid: session.mid, kind: session.kind, live: (session.status, session.statusSince)) {
                    if let kind = session.kind { model.earlier(store.space, kind: kind) }
                }
            case .unrecorded where route.starting:
                // Just started here: nothing is recorded until something is said, and what the agent says
                // before, such as that it is not logged in, is only in its terminal.
                ContentUnavailableView {
                    Label("Say something to start", systemImage: "text.bubble")
                } description: {
                    Text("The conversation shows here as it goes.")
                } actions: {
                    Button("Open terminal") { terminal = true }
                }
            case .unrecorded:
                ContentUnavailableView {
                    Label("No conversation recorded", systemImage: "text.bubble")
                } description: {
                    Text("What is said shows here once the agent records it. If its terminal has a conversation that never shows here, its record can't be found (start Codex with --no-daemon).")
                } actions: {
                    Button("Open terminal") { terminal = true }.buttonStyle(.borderedProminent)
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
                AskingDock(session: session) { terminal = true }
            } else {
                ReplyBar(session: session, draft: $draft, attachments: attachments, voice: voice) { model.didSend($0) }
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
    let openTerminal: () -> Void
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
            Button("Open terminal", systemImage: "apple.terminal", action: openTerminal)
                .buttonStyle(.borderedProminent)
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
