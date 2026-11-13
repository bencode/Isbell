// A session that has ended, from its project's history: its conversation as its agent recorded it,
// read only, and resuming it in a new pane where it ran, after which its live page takes this one's
// place; one running already is gone to instead. As web/src/shell/mobile/sessions/ended.tsx and
// features/session/use-closed-session.ts.

import IsbellKit
import SwiftUI
import os

struct EndedRoute: Hashable {
    let mid: String
    /// A `Project.id`.
    let projectId: String
    let record: SessionRecord
    /// Opened to resume it at once, from a long press.
    var resumeAtOnce = false

    /// This one, opened to resume it at once.
    var toResume: EndedRoute {
        var route = self
        route.resumeAtOnce = true
        return route
    }
}

struct EndedView: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let route: EndedRoute
    /// Opens the session resumed, or found running, in this page's place.
    let resumed: (SessionRoute) -> Void
    @State private var model: ChatModel
    @State private var resuming = false
    @State private var error: CallError?
    /// Resumed, and no agent came up: the pane the command ran in.
    @State private var shell: String?
    @State private var terminal = false
    /// Still to resume as opened: once only, as the page shows again on coming back to its tab.
    @State private var atOnce: Bool

    init(route: EndedRoute, resumed: @escaping (SessionRoute) -> Void) {
        self.route = route
        self.resumed = resumed
        _model = State(initialValue: ChatModel(mid: route.mid))
        _atOnce = State(initialValue: route.resumeAtOnce)
    }

    private var record: SessionRecord { route.record }

    var body: some View {
        let project = store.projects.first { $0.id == route.projectId }
        content
            .chatPaths(project, cwd: record.cwd)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.bg)
            .safeAreaInset(edge: .bottom) { bar(project) }
            .navigationTitle(Text(verbatim: record.first))
            .navigationSubtitle(Text(verbatim: subtitle(project)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarVisibility(.hidden, for: .tabBar)
            .task { await model.readPast(store.space, record: record) }
            .task {
                guard atOnce, let project else { return }
                atOnce = false
                if cannot(project) == nil { await resume(project) }
            }
            .fullScreenCover(isPresented: $terminal, onDismiss: { dismiss() }) {
                if let shell, let project {
                    TerminalScreen(mid: route.mid, paneId: shell, title: record.agent,
                                   place: "\(project.name) · \(project.machine)")
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch model.record {
        case .found where model.turns != nil:
            ChatList(model: model, mid: route.mid, kind: record.agent, live: nil) {
                model.earlier(store.space, kind: record.agent)
            }
        case .finding, .found:
            VStack(spacing: 12) {
                ProgressView("Reading its record…")
                if let error = model.error { Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red) }
            }
        case .unrecorded, .unreadable:
            ContentUnavailableView("The record can't be read", systemImage: "doc.questionmark",
                                   description: Text("It is gone, or too large."))
        }
    }

    private func subtitle(_ project: Project?) -> String {
        let when = Date(timeIntervalSince1970: Double(record.updated) / 1000)
            .formatted(.dateTime.month().day().hour().minute())
        return [project?.name, record.agent, when].compactMap(\.self).joined(separator: " · ")
    }

    private func bar(_ project: Project?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error { Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red) }
            if let why = cannot(project) {
                why.font(.footnote).foregroundStyle(.secondary)
            } else if shell != nil {
                Text("\(record.agent) didn't come up. Its terminal shows what the command said.")
                    .font(.footnote).foregroundStyle(.secondary)
                wide("Open terminal") { terminal = true }
            } else if let project {
                Text("Continues in a new pane in \(shown(record.cwd, in: project))")
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                wide(resuming ? "Resuming…" : "Resume") { Task { await resume(project) } }
                    .disabled(resuming)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }

    private func wide(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 34)
        }
        .buttonStyle(.borderedProminent)
    }

    /// Why it cannot be resumed here, if it cannot.
    private func cannot(_ project: Project?) -> Text? {
        guard resumeArgs(agent: record.agent, id: record.id) != nil else {
            return Text("\(record.agent) sessions can't be resumed.")
        }
        guard let project, project.online, let caps = store.space.machines.first(where: { $0.id == route.mid })?.state.caps
        else { return Text("The machine is offline") }
        if !caps.agentKinds.contains(record.agent) { return Text("\(record.agent) isn't on this machine.") }
        if let launch = record.launch, !caps.methods.contains(launchMethod) {
            return Text("isbell on \(project.machine) is too old to resume it with \(launch). Update it there.")
        }
        return nil
    }

    private func resume(_ project: Project) async {
        // A second tap can come before the button shows it is disabled.
        guard !resuming else { return }
        resuming = true
        error = nil
        defer { resuming = false }
        // Resumed meanwhile, here or elsewhere: go to it rather than run it twice.
        if let paneId = await runningSessions(store.call, project: project)[record.key] {
            return resumed(SessionRoute(mid: route.mid, paneId: paneId))
        }
        do throws(CallError) {
            let started = try await resumeSession(store.call, mid: route.mid, record: record)
            guard started.recognized else {
                shell = started.paneId
                return
            }
            // It opens once its agent can take a message, or after waiting long enough, when its
            // terminal says why not.
            if !(await waitReady(store.call, mid: route.mid, paneId: started.paneId)) {
                logger.warning("\(started.paneId) did not get ready; opening it anyway")
            }
            resumed(SessionRoute(mid: route.mid, paneId: started.paneId, starting: true))
        } catch {
            self.error = error
        }
    }
}

/// `cwd` as the project's own path shows it, where it is in the project.
private func shown(_ cwd: String, in project: Project) -> String {
    cwd == project.path || cwd.hasPrefix("\(project.path)/") ? project.display + cwd.dropFirst(project.path.count) : cwd
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "ended")
