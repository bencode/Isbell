// The first tab: the live sessions of every machine online, by what they wait on, as the web's phone
// home page lists them, and a new one started from it. Reconnecting, the list stays as it was.

import IsbellKit
import SwiftUI

struct ActiveView: View {
    @Environment(SpaceStore.self) private var store
    @State private var path = NavigationPath()
    @State private var creating = false

    var body: some View {
        let lanes = store.lanes
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    lane("Asking you", lanes.asking)
                    lane("Just finished", lanes.finished)
                    lane("Working", lanes.running)
                    if !lanes.standing.isEmpty { StandingLane(placed: lanes.standing) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .background(Color(.systemGroupedBackground))
            .overlay { placeholder(lanes) }
            .navigationTitle("Active")
            .navigationSubtitle(statusLine)
            .navigationDestination(for: SessionRoute.self) { SessionView(route: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New session", systemImage: "plus") { creating = true }.disabled(!store.space.loaded)
                }
            }
            .sheet(isPresented: $creating) { NewSessionSheet { path.append($0) } }
        }
    }

    @ViewBuilder private func lane(_ title: LocalizedStringKey, _ placed: [Placed]) -> some View {
        if !placed.isEmpty {
            LaneHeader(title: title, count: placed.count)
            ForEach(placed) { SessionCard(placed: $0, place: placedWhere($0)) }
        }
    }

    @ViewBuilder private func placeholder(_ lanes: Lanes) -> some View {
        if !store.space.loaded {
            ProgressView("Connecting…")
        } else if store.space.machines.isEmpty {
            ContentUnavailableView(
                "No machines in this space yet", systemImage: "desktopcomputer",
                description: Text("Run `isbell gateway` on a machine to bring it here."))
        } else if [lanes.asking, lanes.finished, lanes.running, lanes.standing].allSatisfy(\.isEmpty) {
            ContentUnavailableView(
                "No sessions running", systemImage: "moon.zzz",
                description: Text("The sessions your agents run on your machines show up here."))
        }
    }

    private var statusLine: Text {
        switch store.space.status {
        case .connecting: Text("Connecting…")
        case .reconnecting: Text("Reconnecting…")
        case .open, .rejected: Text("\(store.space.machines.filter(\.online).count) machines online")
        }
    }
}

struct LaneHeader: View {
    let title: LocalizedStringKey
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
            Text(verbatim: "\(count)").foregroundStyle(.tertiary)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.top, 12)
    }
}

/// The sessions standing by, folded into a line until opened.
private struct StandingLane: View {
    @Environment(SpaceStore.self) private var store
    let placed: [Placed]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation { store.prefs.idleOpen.toggle() }
            } label: {
                HStack {
                    LaneHeader(title: "Standing by", count: placed.count)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(store.prefs.idleOpen ? 90 : 0))
                        .padding(.top, 12)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if store.prefs.idleOpen {
                ForEach(placed) { StandingRow(placed: $0) }
            }
        }
    }
}
