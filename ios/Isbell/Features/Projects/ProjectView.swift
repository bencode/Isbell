// A project's page: its live sessions, as cards like the first tab's, those that ended under them by
// the day, months further back read as the list is scrolled to its end, searched from the bottom, and
// a new one started in it. Its files come later. As web/src/shell/mobile/sessions/sessions.tsx.

import IsbellKit
import SwiftUI

struct ProjectView: View {
    @Environment(SpaceStore.self) private var store
    /// A `Project.id`, looked up on each change so the page stays live.
    let id: String
    /// Opens a session started from here, over this page.
    let open: (SessionRoute) -> Void
    /// Opens one that ended to resume it at once.
    let resume: (EndedRoute) -> Void
    @State private var creating = false
    @State private var history = SessionHistory()
    @State private var query = ""

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
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let past = project?.online == true ? history.history.filter { history.running[$0.key] == nil } : []
        let found = needle.isEmpty ? past : past.filter { matches($0, needle) }
        // Searching reads every month: once the latest are read and no month is being read, and not
        // again after a failure until a read goes well.
        let searchWaits = needle.isEmpty || history.records == nil || history.busy || history.error != nil
        // The machine says where its records are, and they are not read yet.
        let reading = history.records == nil && project.map { store.space.recorded[$0.mid] != nil } == true
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if let project { place(project) }
                if !live.isEmpty {
                    LaneHeader(title: "Running", count: live.count)
                    ForEach(live) { SessionCard(placed: $0, place: $0.session.kind ?? $0.session.name) }
                }
                if let project {
                    if !needle.isEmpty {
                        results(found, needle: needle, project: project)
                    } else if !past.isEmpty {
                        LaneHeader(title: "History", count: past.count)
                        ForEach(byDay(past, at: \.updated), id: \.[0].key) { day in
                            DayHeader(at: day[0].updated)
                            rows(day, needle: "", project: project)
                        }
                        if history.more {
                            // Each month read while it is in view, until the list reaches past it.
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .task(id: history.read) { await history.readOlder(store.space, project: project, all: false) }
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
        .background(Palette.bg)
        .sessionActions()
        .overlay {
            if project?.online == false {
                ContentUnavailableView("The machine is offline", systemImage: "desktopcomputer")
            } else if live.isEmpty && past.isEmpty && !reading && needle.isEmpty {
                ContentUnavailableView("Nothing running here", systemImage: "moon.zzz")
            }
        }
        .searchable(text: $query, prompt: Text("Find a session"))
        .task(id: searchWaits) {
            if !searchWaits, let project { await history.readOlder(store.space, project: project, all: true) }
        }
        .navigationTitle(project?.name ?? "")
        .navigationBarTitleDisplayMode(.large)
        .toolbarVisibility(.hidden, for: .tabBar)
        .toolbar {
            // With the tab bar hidden, the search has no place but the bottom bar.
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: FilesRoute(projectId: id)) { Label("Files", systemImage: "folder") }
                    .disabled(project?.online != true || project?.path.isEmpty != false)
            }
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

    /// What a search found, as one list, each row with its day.
    @ViewBuilder private func results(_ found: [SessionRecord], needle: String, project: Project) -> some View {
        if !found.isEmpty && !history.busy {
            Text("\(found.count) found")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.top, 12)
        }
        if !found.isEmpty { rows(found, needle: needle, project: project) }
        if history.busy {
            ProgressView("Reading older sessions…").frame(maxWidth: .infinity)
        } else if found.isEmpty {
            Text("No sessions match").font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        }
    }

    /// The machine, whether it is online, and the project's directory, under the title.
    private func place(_ project: Project) -> some View {
        HStack(spacing: 6) {
            Circle().fill(project.online ? Palette.ok : Color.secondary.opacity(0.4)).frame(width: 8, height: 8)
            Text(verbatim: project.machine)
            Text(verbatim: "·")
            Text(verbatim: project.display).monospaced().lineLimit(1).truncationMode(.middle)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    /// Sessions that ended, as one group of rows.
    private func rows(_ records: [SessionRecord], needle: String, project: Project) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(records.enumerated()), id: \.element.key) { i, r in
                if i > 0 { Divider().overlay(Palette.line) }
                HistoryRow(record: r, route: EndedRoute(mid: project.mid, projectId: id, record: r), resume: resume,
                           needle: needle)
            }
        }
        .background(Palette.raised, in: .rect(cornerRadius: 12))
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

/// A session that ended: what it was first asked, the agent and when; opens it, read only, and
/// resumes it from a long press. Found by a search, what it was found by is in bold, and it shows
/// its day.
private struct HistoryRow: View {
    let record: SessionRecord
    let route: EndedRoute
    let resume: (EndedRoute) -> Void
    var needle = ""

    var body: some View {
        let at = Date(timeIntervalSince1970: Double(record.updated) / 1000)
        // Found by something other than what it was first asked: what it was found by.
        let by = needle.isEmpty || record.first.lowercased().contains(needle)
            ? nil : [record.last, record.cwd].first { $0.lowercased().contains(needle) }
        NavigationLink(value: route) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(marked(record.first, needle)).font(.callout.weight(.semibold)).lineLimit(2)
                    if let by {
                        Text(marked(excerpt(by, needle), needle)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    // Its day too where the rows are not under their day.
                    let when = at.formatted(needle.isEmpty ? .dateTime.hour().minute() : .dateTime.month().day().hour().minute())
                    Text(verbatim: "\(record.agent) · \(when)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contentShape(.contextMenuPreview, .rect(cornerRadius: 12))
        .contextMenu {
            if resumeArgs(agent: record.agent, id: record.id) != nil {
                Button("Resume", systemImage: "arrow.clockwise") { resume(route.toResume) }
            }
        }
    }
}
