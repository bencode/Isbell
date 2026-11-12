// Starting an agent in a project: which agent, which project, with what was used last chosen already.
// Started, it is put away and the session opens. As web/src/shell/mobile/new-session.tsx.

import IsbellKit
import SwiftUI

/// The agents Isbell is built for, as web/src/model/agents.ts: any other runs in a terminal.
private let chatAgents = ["claude", "codex", "pi"]

struct NewSessionSheet: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onStarted: (SessionRoute) -> Void
    @State private var picked: String?
    @State private var chosen: String?
    @State private var query = ""
    @State private var starting = false
    @State private var error: CallError?

    /// `preset`: a project chosen already (`Project.id`), from its page.
    init(preset: String? = nil, onStarted: @escaping (SessionRoute) -> Void) {
        self.onStarted = onStarted
        _picked = State(initialValue: preset)
    }

    var body: some View {
        let startable = store.projects.filter { $0.online && $0.configured && !$0.path.isEmpty }
        let project = startable.first { $0.id == (picked ?? store.prefs.recentProjects.first) }
        let installed = project.flatMap { p in store.space.machines.first { $0.id == p.mid }?.state.caps.agentKinds }
        let has = { (kind: String) in installed?.contains(kind) ?? true }
        let kind = ([chosen, store.prefs.lastAgent] + chatAgents).compactMap(\.self)
            .first { chatAgents.contains($0) && has($0) }
        let shown = startable.filter(matches)
        let recent = store.prefs.recentProjects.compactMap { id in shown.first { $0.id == id } }
        let groups = store.space.machines
            .map { m in (m, shown.filter { p in p.mid == m.id && !recent.contains(p) }) }
            .filter { !$0.1.isEmpty }
        NavigationStack {
            List {
                Section("Agent") {
                    HStack(spacing: 8) {
                        ForEach(chatAgents, id: \.self) { k in
                            agentButton(k, on: k == kind).disabled(!has(k))
                        }
                    }
                }
                if !recent.isEmpty {
                    Section("Recent") { ForEach(recent) { row($0, picked: $0 == project, where: true) } }
                }
                ForEach(groups, id: \.0.id) { machine, projects in
                    Section {
                        ForEach(projects) { row($0, picked: $0 == project, where: false) }
                    } header: {
                        Text(verbatim: machine.state.machine.name)
                    }
                }
            }
            .overlay {
                if store.space.loaded && startable.isEmpty {
                    ContentUnavailableView("No projects to start in", systemImage: "folder")
                }
            }
            .searchable(text: $query, prompt: Text("Find a project"))
            .disabled(starting)
            .safeAreaInset(edge: .bottom) { footer(project, kind) }
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(starting)
                }
            }
        }
        .interactiveDismissDisabled(starting)
    }

    private func matches(_ p: Project) -> Bool {
        query.isEmpty || [p.name, p.display, p.machine].contains { $0.localizedCaseInsensitiveContains(query) }
    }

    private func agentButton(_ kind: String, on: Bool) -> some View {
        Button {
            chosen = kind
        } label: {
            Text(verbatim: kind)
                .font(.system(size: 15, weight: on ? .semibold : .regular, design: .monospaced))
                .frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.bordered)
        .tint(on ? .accentColor : .secondary)
    }

    /// A project to start in; in the recent ones, with the machine it is on.
    private func row(_ p: Project, picked: Bool, where machine: Bool) -> some View {
        Button {
            self.picked = p.id
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: p.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Text(verbatim: machine ? "\(p.display) · \(p.machine)" : p.display)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if picked { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
    }

    private func footer(_ project: Project?, _ kind: String?) -> some View {
        VStack(spacing: 8) {
            if let error {
                Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button {
                if let project, let kind { Task { await start(project, kind) } }
            } label: {
                Group {
                    if starting {
                        Text("Starting…")
                    } else if let project, let kind {
                        Text("Start \(kind) in \(project.name)")
                    } else {
                        Text("Pick a project")
                    }
                }
                .font(.body.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.borderedProminent)
            .disabled(project == nil || kind == nil || starting)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func start(_ project: Project, _ kind: String) async {
        // A second tap can come before the button shows it is disabled.
        guard !starting else { return }
        starting = true
        error = nil
        do throws(CallError) {
            let started = try await startAgent(store.call, mid: project.mid, cwd: project.path, kind: kind)
            store.prefs.used(project: project.id, agent: kind)
            dismiss()
            onStarted(SessionRoute(mid: project.mid, paneId: started.paneId, starting: true))
        } catch {
            self.error = error
            starting = false
        }
    }
}
