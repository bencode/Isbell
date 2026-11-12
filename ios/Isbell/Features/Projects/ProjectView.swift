// A project's page: its live sessions, as cards like the first tab's, and a new one started in it.
// Its history and files come later.

import IsbellKit
import SwiftUI

struct ProjectView: View {
    @Environment(SpaceStore.self) private var store
    /// A `Project.id`, looked up on each change so the page stays live.
    let id: String
    /// Opens a session started from here, over this page.
    let open: (SessionRoute) -> Void
    @State private var creating = false

    var body: some View {
        let project = store.projects.first { $0.id == id }
        let live = project.map { p in p.online ? p.sessions.map { Placed(session: $0, project: p) } : [] } ?? []
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if !live.isEmpty {
                    LaneHeader(title: "Running", count: live.count)
                    ForEach(live) { SessionCard(placed: $0, place: $0.session.kind ?? $0.session.name) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
        .overlay {
            if project?.online == false {
                ContentUnavailableView("The machine is offline", systemImage: "desktopcomputer")
            } else if live.isEmpty {
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
    }
}
