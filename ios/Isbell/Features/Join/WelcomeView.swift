import SwiftUI

struct WelcomeView: View {
    let rejected: Bool

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "apple.terminal.on.rectangle")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
            Text("Connect your machines")
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text("Paste the key printed by `isbell space show` on any of your machines.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if rejected {
                Label("The relay did not accept this key.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }
            Spacer()
            // In the lower half, where a thumb reaches.
            NavigationLink {
                PasteKeyView()
            } label: {
                Text("Paste Key").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            Link("No space yet? How to install", destination: URL(string: "https://github.com/bencode/Isbell#readme")!)
                .font(.footnote)
        }
        .padding(24)
    }
}
