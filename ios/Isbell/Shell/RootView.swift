import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        switch app.phase {
        case .join(let rejected):
            NavigationStack { WelcomeView(rejected: rejected) }
        case .joined(let store):
            ConnectedView(store: store)
        }
    }
}
