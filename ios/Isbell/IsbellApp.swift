import SwiftUI

@main
struct IsbellApp: App {
    @State private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Palette.accent)
                .preferredColorScheme(app.prefs.theme.colorScheme)
        }
        // In front, the space keeps up with its machines; back from the background, a retry
        // waiting out its backoff dials at once.
        .onChange(of: scenePhase, initial: true) { _, phase in
            app.setActive(phase == .active)
        }
    }
}
