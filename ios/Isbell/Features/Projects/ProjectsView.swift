// The second tab: each machine's projects, as the PC sidebar lists them, with how loaded the machine
// is. A machine's line opens its info; a project opens its page.

import IsbellKit
import SwiftUI
import os

struct ProjectsView: View {
    @Environment(SpaceStore.self) private var store
    @State private var shown: ShownMachine?
    @State private var path = NavigationPath()
    @State private var settings = false
    @Environment(\.colorScheme) private var scheme

    private struct ShownMachine: Identifiable {
        let id: String
    }

    var body: some View {
        let projects = store.projects
        NavigationStack(path: $path) {
            List {
                Group {
                    ForEach(store.space.machines) { entry in
                        Section {
                            ForEach(projects.filter { $0.mid == entry.id && $0.configured && !$0.path.isEmpty }) { project in
                                NavigationLink(value: project.id) { ProjectRow(project: project) }
                                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                            }
                        } header: {
                            MachineHeader(entry: entry) { shown = ShownMachine(id: entry.id) }
                        }
                    }
                }
                .listRowBackground(Palette.raised)
            }
            .paletteList()
            .overlay {
                if !store.space.loaded { ProgressView("Connecting…") }
            }
            .navigationTitle("Projects")
            .navigationDestination(for: String.self) {
                ProjectView(id: $0, open: { path.append($0) }, resume: { path.append($0) })
            }
            .navigationDestination(for: SessionRoute.self) { SessionView(route: $0) }
            .navigationDestination(for: FilesRoute.self) { FilesView(route: $0) }
            // Resumed, its live page takes the ended one's place.
            .navigationDestination(for: EndedRoute.self) {
                EndedView(route: $0) { live in
                    path.removeLast()
                    path.append(live)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { settings = true } label: {
                        Image(systemName: "gearshape").accessibilityLabel(Text("Settings"))
                    }
                }
            }
            .sheet(item: $shown) { MachineInfoSheet(mid: $0.id) }
            .sheet(isPresented: $settings) {
                // As this page is: a sheet open does not follow the theme set back to the system's.
                NavigationStack { SettingsView() }.preferredColorScheme(scheme)
            }
        }
    }
}

/// A machine's name, and its CPU and memory read every 10 s while it shows.
private struct MachineHeader: View {
    @Environment(SpaceStore.self) private var store
    let entry: MachineEntry
    let open: () -> Void
    @State private var system: System?

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Circle()
                    .fill(entry.online ? Palette.ok : Color.secondary.opacity(0.4))
                    .frame(width: 8, height: 8)
                Text(entry.state.machine.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                if !entry.online {
                    Text("Offline")
                } else if let system {
                    let cpu = percent(system.cpu.usage)
                    let memory = percent(used: system.memory.used, of: system.memory.total)
                    // In larger text, the numbers alone.
                    ViewThatFits(in: .horizontal) {
                        Text("CPU \(cpu) · Memory \(memory)")
                        Text(verbatim: "\(cpu) · \(memory)")
                    }
                    .lineLimit(1)
                }
                Image(systemName: "chevron.right")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .textCase(nil)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .task(id: entry.online) { await readLoad() }
    }

    private func readLoad() async {
        guard entry.online else {
            system = nil
            return
        }
        repeat {
            do {
                system = try await readSystem(store.call, mid: entry.id)
            } catch {
                // The last reading stays.
                logger.warning("could not read the load of \(entry.id): \(error.msg)")
            }
        } while await pause(.seconds(10))
    }
}

private struct ProjectRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(project.name).font(.subheadline.weight(.semibold))
                Text(verbatim: project.display)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if project.online && !project.sessions.isEmpty {
                HStack(spacing: 4) {
                    ForEach(shown, id: \.self) { StatusDot(status: $0) }
                    Text(verbatim: "\(project.sessions.count)").font(.caption.weight(.semibold).monospacedDigit())
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Palette.raised2, in: .capsule)
            }
        }
    }

    /// Each status its sessions are in, the most pressing first: asking, working, finished.
    private var shown: [AgentStatus] {
        [.blocked, .working, .done].filter { status in project.sessions.contains { $0.status == status } }
    }
}

func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }

func percent(used: Int64, of total: Int64) -> String {
    total > 0 ? percent(Double(used) / Double(total) * 100) : "—"
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "projects")
