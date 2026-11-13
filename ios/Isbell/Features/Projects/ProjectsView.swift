// The second tab: each machine's projects, as the PC sidebar lists them, with how loaded the machine
// is. A machine's line opens its info; a project opens its page.

import IsbellKit
import SwiftUI
import os

struct ProjectsView: View {
    @Environment(SpaceStore.self) private var store
    @State private var shown: ShownMachine?
    @State private var path = NavigationPath()

    private struct ShownMachine: Identifiable {
        let id: String
    }

    var body: some View {
        let projects = store.projects
        NavigationStack(path: $path) {
            List {
                ForEach(store.space.machines) { entry in
                    Section {
                        ForEach(projects.filter { $0.mid == entry.id && $0.configured && !$0.path.isEmpty }) { project in
                            NavigationLink(value: project.id) { ProjectRow(project: project) }
                        }
                    } header: {
                        MachineHeader(entry: entry) { shown = ShownMachine(id: entry.id) }
                    }
                }
            }
            .overlay {
                if !store.space.loaded { ProgressView("Connecting…") }
            }
            .navigationTitle("Projects")
            .navigationDestination(for: String.self) { ProjectView(id: $0, open: { path.append($0) }, resume: { path.append($0) }) }
            .navigationDestination(for: SessionRoute.self) { SessionView(route: $0) }
            // Resumed, its live page takes the ended one's place.
            .navigationDestination(for: EndedRoute.self) {
                EndedView(route: $0) { live in
                    path.removeLast()
                    path.append(live)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape").accessibilityLabel(Text("Settings"))
                    }
                }
            }
            .sheet(item: $shown) { MachineInfoSheet(mid: $0.id) }
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
                    .fill(entry.online ? Color.green : Color.secondary.opacity(0.4))
                    .frame(width: 8, height: 8)
                Text(entry.state.machine.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Spacer(minLength: 8)
                if !entry.online {
                    Text("Offline")
                } else if let system {
                    Text("CPU \(percent(system.cpu.usage)) · Memory \(percent(used: system.memory.used, of: system.memory.total))")
                }
                Image(systemName: "info.circle")
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
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                Text(verbatim: project.display)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if project.online, let tint = tint(project.sessions) {
                Text(verbatim: "\(project.sessions.count)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(tint.opacity(0.15), in: .capsule)
            }
        }
    }

    /// The most pressing of its sessions colors the count: one that asks, then one finished unseen,
    /// then one working; none when it has no session.
    private func tint(_ sessions: [Session]) -> Color? {
        if sessions.contains(where: { $0.status == .blocked }) { return .orange }
        if sessions.contains(where: { $0.status == .done && $0.unread }) { return .green }
        if sessions.contains(where: { $0.status == .working }) { return .accentColor }
        return sessions.isEmpty ? nil : .secondary
    }
}

func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }

func percent(used: Int64, of total: Int64) -> String {
    total > 0 ? percent(Double(used) / Double(total) * 100) : "—"
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "projects")
