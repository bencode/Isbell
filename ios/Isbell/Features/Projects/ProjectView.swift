// A project's page: its live sessions, as cards like the first tab's, those that ended under them by
// the day, the latest of them as recorded, and a new one started in it. Its files come later.

import IsbellKit
import SwiftUI

struct ProjectView: View {
    @Environment(SpaceStore.self) private var store
    /// A `Project.id`, looked up on each change so the page stays live.
    let id: String
    /// Opens a session started from here, over this page.
    let open: (SessionRoute) -> Void
    @State private var creating = false
    @State private var history = SessionHistory()

    /// The history is read again as the machine records a session of the project, and as panes come
    /// and go, which moves sessions in and out of it.
    private struct HistoryKey: Hashable {
        let updated: [Int64]
        let panes: [String]
        let online: Bool
    }

    var body: some View {
        let project = store.projects.first { $0.id == id }
        let live = project.map { p in p.online ? p.sessions.map { Placed(session: $0, project: p) } : [] } ?? []
        let past = project?.online == true ? (history.records ?? []).filter { history.running[$0.key] == nil } : []
        // The machine says where its records are, and they are not read yet.
        let reading = history.records == nil && project.map { store.space.recorded[$0.mid] != nil } == true
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if !live.isEmpty {
                    LaneHeader(title: "Running", count: live.count)
                    ForEach(live) { SessionCard(placed: $0, place: $0.session.kind ?? $0.session.name) }
                }
                if !past.isEmpty, let project {
                    LaneHeader(title: "History", count: past.count)
                    ForEach(byDay(past, at: \.updated), id: \.[0].key) { day in
                        DayHeader(at: day[0].updated)
                        ForEach(day, id: \.key) { r in
                            HistoryRow(record: r, route: EndedRoute(mid: project.mid, projectId: id, record: r))
                        }
                    }
                }
                if let error = history.error, project?.online == true {
                    Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
        .overlay {
            if project?.online == false {
                ContentUnavailableView("The machine is offline", systemImage: "desktopcomputer")
            } else if live.isEmpty && past.isEmpty && !reading {
                ContentUnavailableView("Nothing running here", systemImage: "moon.zzz")
            }
        }
        .navigationTitle(project?.name ?? "")
        .navigationSubtitle(Text(verbatim: project.map { "\($0.machine) · \($0.display)" } ?? ""))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New session", systemImage: "plus") { creating = true }
                    .disabled(project?.online != true || project?.path.isEmpty != false)
            }
        }
        .sheet(isPresented: $creating) { NewSessionSheet(preset: id, onStarted: open) }
        .task(id: project.map(historyKey)) {
            if let project, project.online { await history.load(store.space, project: project) }
        }
    }

    private func historyKey(_ p: Project) -> HistoryKey {
        let roots = store.space.recorded[p.mid] ?? [:]
        let keys = Set(recordSources(roots, path: p.path).map(\.key))
        return HistoryKey(updated: roots.values.filter { keys.contains($0.key) }.map(\.updated).sorted(),
                          panes: p.sessions.map(\.paneId), online: p.online)
    }
}

/// A day's title in the history: today, yesterday, or its date.
private struct DayHeader: View {
    let at: Int64

    var body: some View {
        let date = Date(timeIntervalSince1970: Double(at) / 1000)
        Group {
            if Calendar.current.isDateInToday(date) {
                Text("Today")
            } else if Calendar.current.isDateInYesterday(date) {
                Text("Yesterday")
            } else {
                Text(date, format: .dateTime.month().day().weekday())
            }
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.top, 6)
    }
}

/// A session that ended: what it was first asked, and last where that is something else; opens it,
/// read only.
private struct HistoryRow: View {
    let record: SessionRecord
    let route: EndedRoute

    var body: some View {
        NavigationLink(value: route) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: record.first).font(.body).lineLimit(2)
                if !record.last.isEmpty && record.last != record.first {
                    Text(verbatim: record.last).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                HStack {
                    Text(verbatim: record.agent)
                    Spacer()
                    Text(Date(timeIntervalSince1970: Double(record.updated) / 1000), format: .dateTime.hour().minute())
                }
                .font(.caption.monospaced())
                .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
