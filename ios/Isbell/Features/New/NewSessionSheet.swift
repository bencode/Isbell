// Starting an agent in a project: which of the machine's start templates, which project, with what was
// used last chosen already. Started, it is put away and the session opens; started by a command herdr
// did not see an agent come up from, its terminal shows what the command said. As
// web/src/shell/mobile/new-session.tsx.

import IsbellKit
import SwiftUI
import os

struct NewSessionSheet: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onStarted: (SessionRoute) -> Void
    @State private var picked: String?
    /// A template's name.
    @State private var chosen: String?
    @State private var query = ""
    @State private var starting = false
    @State private var error: CallError?
    /// What each machine's file said, by machine id, read as the sheet shows its projects.
    @State private var read: [String: Templates] = [:]
    /// Started, and no agent came up: the pane the command ran in.
    @State private var unrecognized: Unrecognized?
    @State private var terminal = false

    private struct Unrecognized {
        let paneId: String
        let template: StartTemplate
        let project: Project
    }

    /// `preset`: a project chosen already (`Project.id`), from its page.
    init(preset: String? = nil, onStarted: @escaping (SessionRoute) -> Void) {
        self.onStarted = onStarted
        _picked = State(initialValue: preset)
    }

    var body: some View {
        let startable = store.projects.filter { $0.online && $0.configured && !$0.path.isEmpty }
        let project = startable.first { $0.id == (picked ?? store.prefs.recentProjects.first) }
        let caps = project.flatMap { p in store.space.machines.first { $0.id == p.mid }?.state.caps }
        // Those of agents herdr knows on the project's machine; what was used last is a template's
        // name, which is the agent's for one that starts it by its name.
        let templates = templatesOf(project.flatMap { read[$0.mid] })
            .filter { t in caps.map { $0.agentKinds.contains(t.agent) } ?? true }
        let can = { (t: StartTemplate) in caps.map { usable(t, $0) } ?? true }
        let template = ([chosen, store.prefs.lastAgent] + templates.map(\.name)).compactMap(\.self)
            .lazy.compactMap { name in templates.first { $0.name == name && can($0) } }.first
        let shown = startable.filter(matches)
        let recent = store.prefs.recentProjects.compactMap { id in shown.first { $0.id == id } }
        let groups = store.space.machines
            .map { m in (m, shown.filter { p in p.mid == m.id && !recent.contains(p) }) }
            .filter { !$0.1.isEmpty }
        NavigationStack {
            List {
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(templates, id: \.name) { t in
                            templateButton(t, on: t == template).disabled(!can(t))
                        }
                    }
                } header: {
                    Text("Start with")
                } footer: {
                    if let project, templates.contains(where: { !can($0) }) {
                        Text("Custom commands need isbell 0.8.0 or newer on \(project.machine).")
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
            .disabled(starting || unrecognized != nil)
            .safeAreaInset(edge: .bottom) { footer(project, template) }
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(starting)
                }
            }
        }
        .interactiveDismissDisabled(starting)
        // Read each time the sheet shows the machine, as the file is changed by hand on it.
        .task(id: project?.mid) {
            guard let mid = project?.mid else { return }
            do throws(CallError) {
                read[mid] = try await readTemplates(store.space.open, mid: mid)
            } catch {
                logger.warning("cannot read the start templates of \(mid): \(error.msg)")
            }
        }
        .fullScreenCover(isPresented: $terminal, onDismiss: { dismiss() }) {
            if let u = unrecognized {
                TerminalScreen(mid: u.project.mid, paneId: u.paneId, title: u.template.name,
                               place: "\(u.project.name) · \(u.project.machine)")
            }
        }
    }

    private func matches(_ p: Project) -> Bool {
        query.isEmpty || [p.name, p.display, p.machine].contains { $0.localizedCaseInsensitiveContains(query) }
    }

    /// A template; one started by its agent's own name shows it as a command.
    private func templateButton(_ t: StartTemplate, on: Bool) -> some View {
        Button {
            chosen = t.name
        } label: {
            Text(verbatim: t.name)
                .font(.system(size: 15, weight: on ? .semibold : .regular, design: plain(t) ? .monospaced : .default))
                .lineLimit(1)
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

    private func footer(_ project: Project?, _ template: StartTemplate?) -> some View {
        VStack(spacing: 8) {
            if let error {
                Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let u = unrecognized {
                Text("\(u.template.agent) didn't come up. Its terminal shows what the command said.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    terminal = true
                } label: {
                    Text("Open terminal").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button {
                    if let project, let template { Task { await start(project, template) } }
                } label: {
                    Group {
                        if starting {
                            Text("Starting…")
                        } else if let project, let template {
                            Text("Start \(template.name) in \(project.name)")
                        } else {
                            Text("Pick a project")
                        }
                    }
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.borderedProminent)
                .disabled(project == nil || template == nil || starting)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func start(_ project: Project, _ template: StartTemplate) async {
        // A second tap can come before the button shows it is disabled.
        guard !starting else { return }
        starting = true
        error = nil
        do throws(CallError) {
            let started = try await startTemplate(store.call, mid: project.mid, cwd: project.path, template: template)
            store.prefs.used(project: project.id, agent: template.name)
            guard started.recognized else {
                starting = false
                unrecognized = Unrecognized(paneId: started.paneId, template: template, project: project)
                return
            }
            // The session opens once its agent can take a message, or after waiting long enough, when
            // its terminal says why not.
            if !(await waitReady(store.call, mid: project.mid, paneId: started.paneId)) {
                logger.warning("\(started.paneId) did not get ready; opening it anyway")
            }
            dismiss()
            onStarted(SessionRoute(mid: project.mid, paneId: started.paneId, starting: true))
        } catch {
            self.error = error
            starting = false
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "new-session")
