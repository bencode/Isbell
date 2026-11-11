// The first screen once joined, until the tabs come: how the relay connection is, and the space's
// machines.

import IsbellKit
import SwiftUI

struct ConnectedView: View {
    @Environment(AppModel.self) private var app
    let store: SpaceStore
    @State private var confirmingLeave = false

    var body: some View {
        NavigationStack {
            List(store.machines) { MachineRow(entry: $0) }
                .overlay { placeholder }
                .navigationTitle("Isbell")
                .navigationSubtitle(statusText)
                .toolbar {
                    Menu {
                        Button("Leave Space", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            confirmingLeave = true
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
                .confirmationDialog("Leave this space?", isPresented: $confirmingLeave, titleVisibility: .visible) {
                    Button("Leave Space", role: .destructive) { app.leave() }
                } message: {
                    Text("The key is removed from this iPhone. You can join again with the same key.")
                }
        }
    }

    @ViewBuilder private var placeholder: some View {
        if !store.loaded {
            ProgressView("Connecting…")
        } else if store.machines.isEmpty {
            ContentUnavailableView(
                "No machines in this space yet", systemImage: "desktopcomputer",
                description: Text("Run `isbell gateway` on a machine to bring it here."))
        }
    }

    private var statusText: LocalizedStringKey {
        switch store.status {
        case .connecting: "Connecting…"
        case .reconnecting: "Reconnecting…"
        case .open, .rejected: "Connected"
        }
    }
}

private struct MachineRow: View {
    let entry: MachineEntry

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(entry.online ? Color.green : Color.secondary.opacity(0.4))
                .frame(width: 8, height: 8)
                .accessibilityLabel(entry.online ? Text("Online") : Text("Offline"))
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.state.machine.name)
                Text(entry.state.machine.hostname).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(entry.state.agents.count) agents").font(.footnote).foregroundStyle(.secondary)
        }
    }
}
