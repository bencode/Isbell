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
    /// Whether its terminal is open, full screen, from what is on the page; its menu opens it as a card's does.
    @State private var terminal = false
    /// The session as last placed: once it was, the page no longer waits for it.
    @State private var last: Placed?

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
                    .chatPaths(placed.project, cwd: placed.session.cwd)
                    .toolbar {
                        ToolbarItem(placement: .principal) { heading(placed) }
                        ToolbarItem(placement: .topBarTrailing) {
                            Menu("More", systemImage: "ellipsis.circle") { SessionMenu(placed: placed) }
                        }
                    }
                    .sessionActions()
                    .fullScreenCover(isPresented: $terminal) { TerminalScreen(placed: placed) }
            } else if route.starting && last == nil {
                ProgressView("Starting…")
            } else if route.starting, let last {
                // Started here and gone since: the agent quit, and its pane says why.
                ContentUnavailableView {
                    Label("This session has ended", systemImage: "checkmark.circle")
                } description: {
                    Text("Its terminal shows what the agent said last.")
                } actions: {
                    Button("Open terminal") { terminal = true }
                }
                .fullScreenCover(isPresented: $terminal) { TerminalScreen(placed: last) }
            } else {
                ContentUnavailableView("This session has ended", systemImage: "checkmark.circle")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.bg)
        .onChange(of: placed, initial: true) { _, now in if let now { last = now } }
        .navigationTitle(placed.map(placedTitle) ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        // A recording left behind is dropped; iOS would cut it off in the background anyway.
        .onDisappear { voice.discard() }
        .onChange(of: phase) { _, now in
            if now == .background { voice.discard() }
        }
    }

    /// Its title, and under it where it runs after its status, or the relay link while it is down; in
    /// the bar's middle, as a subtitle would drop the colors.
    private func heading(_ placed: Placed) -> some View {
        VStack(spacing: 1) {
            Text(placedTitle(placed)).font(.subheadline.weight(.semibold)).lineLimit(1)
            HStack(spacing: 5) {
                if let down = linkLine(store.space.status) {
                    down
                } else {
                    StatusDot(status: placed.session.status)
                    Text(verbatim: placedWhere(placed))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
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

/// What the agent asks leave for, read once it asks; it is answered in its terminal.
private struct AskingDock: View {
    @Environment(SpaceStore.self) private var store
    let session: Session
    let openTerminal: () -> Void
    @State private var asking: ToolUse?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                StatusDot(status: .blocked)
                Text("\(session.name) is asking you").lineLimit(1)
                Spacer(minLength: 8)
                Elapsed(since: session.statusSince).font(.caption.monospaced()).foregroundStyle(.tertiary)
            }
            .font(.subheadline.weight(.semibold))
            if let asking {
                ScrollView {
                    (Text(verbatim: asking.tool).bold() + Text(verbatim: asking.target.map { "  \($0)" } ?? ""))
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 110)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Palette.raised, in: .rect(cornerRadius: 10))
            }
            Button(action: openTerminal) {
                Label("Answer in the terminal", systemImage: "apple.terminal")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            Text("Answer with the agent's own menu; this turns back into the reply bar once you are back.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ask, in: .rect(cornerRadius: 20))
        .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.askLine, lineWidth: 1) }
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
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
