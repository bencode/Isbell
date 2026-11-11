import SwiftUI

@main
struct IsbellApp: App {
    @State private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView().environment(app)
        }
        // Back from the background, a retry waiting out its backoff dials at once.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { app.reconnectNow() }
        }
    }
}
