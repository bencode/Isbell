// What a live session's long press, or its page's menu, does: opens its terminal, its files or its
// info, or ends it once confirmed. The list holds them rather than the card, which is made anew as its
// session moves between lanes, and would take a terminal shown from it away. As
// web/src/features/session/end-pane-dialog.tsx.

import IsbellKit
import SwiftUI
import os

@MainActor
@Observable
final class SessionActions {
    var terminal: Placed?
    var files: FilesRoute?
    var info: Placed?
    var ending: Placed?
    var failed: CallError?
}

extension View {
    /// Does what the long press of a session listed under it asks for.
    func sessionActions() -> some View { modifier(SessionActionsHost()) }
}

/// The long press menu of a live session, in a list under `sessionActions()`.
struct SessionMenu: View {
    @Environment(SessionActions.self) private var actions
    let placed: Placed

    var body: some View {
        Button("Open terminal", systemImage: "apple.terminal") { actions.terminal = placed }
        Button("Files", systemImage: "folder") {
            actions.files = FilesRoute(projectId: placed.project.id, at: placed.session.cwd)
        }
        Button("Session info", systemImage: "info.circle") { actions.info = placed }
        Button("End session", systemImage: "xmark.circle", role: .destructive) { actions.ending = placed }
    }
}

private struct SessionActionsHost: ViewModifier {
    @Environment(SpaceStore.self) private var store
    @State private var actions = SessionActions()

    func body(content: Content) -> some View {
        @Bindable var actions = actions
        content
            .environment(actions)
            .fullScreenCover(item: $actions.terminal) { TerminalScreen(placed: $0) }
            .navigationDestination(item: $actions.files) { FilesView(route: $0) }
            .sheet(item: $actions.info) { SessionInfoSheet(placed: $0).presentationDetents([.medium, .large]) }
            .confirmationDialog("End this session?", isPresented: isSet($actions.ending), titleVisibility: .visible,
                                presenting: actions.ending) { placed in
                Button("End session", role: .destructive) { Task { await end(placed) } }
                Button("Leave it running", role: .cancel) {}
            } message: { placed in
                Text("This stops \(placedTitle(placed)) and closes its pane on \(placed.project.machine). What it changed in \(placed.project.display) stays.")
            }
            .alert("Couldn't end the session", isPresented: isSet($actions.failed), presenting: actions.failed) { _ in
                Button("OK", role: .cancel) {}
            } message: { Text(verbatim: $0.msg) }
    }

    /// Its pane is gone from the list as herdr says it closed.
    private func end(_ placed: Placed) async {
        do throws(CallError) {
            try await closePane(store.call, mid: placed.session.mid, paneId: placed.session.paneId)
        } catch {
            logger.warning("could not end \(placed.session.paneId): \(error.msg)")
            actions.failed = error
        }
    }
}

/// Shown while `value` is set; dismissed, it is cleared.
private func isSet<T>(_ value: Binding<T?>) -> Binding<Bool> {
    Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "actions")
