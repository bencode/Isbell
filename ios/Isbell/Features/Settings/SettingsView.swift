// Settings, from the projects tab: the look, how to add a machine, the space key, and leaving.

import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(SpaceStore.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var confirmingLeave = false

    var body: some View {
        @Bindable var prefs = store.prefs
        Form {
            Group {
                Section("Appearance") {
                    Picker("Theme", selection: $prefs.theme) {
                        Text("Match System").tag(Theme.system)
                        Text("Light").tag(Theme.light)
                        Text("Dark").tag(Theme.dark)
                    }
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    } label: {
                        LabeledContent("Language") { Text("Set per app in iOS Settings") }
                    }
                    .tint(.primary)
                }
                Section {
                    CommandRow(command: "curl -fsSL https://isbell.fmap.dev/install.sh | sh")
                    CommandRow(command: "isbell gateway")
                } header: {
                    Text("Add a machine")
                } footer: {
                    Text("Run these two on a machine with herdr installed.")
                }
                Section {
                    Button("Copy Space Key", systemImage: "key") { UIPasteboard.general.string = store.identity.key }
                } header: {
                    Text("Space")
                } footer: {
                    Text("The key is kept only on this iPhone.")
                }
                Section {
                    Button("Leave Space", role: .destructive) { confirmingLeave = true }
                } footer: {
                    Text(verbatim: footer).frame(maxWidth: .infinity).padding(.top, 16)
                }
            }
            .listRowBackground(Palette.raised)
        }
        .paletteList()
        .navigationTitle("Settings")
        .toolbarVisibility(.hidden, for: .tabBar)
        .confirmationDialog("Leave this space?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave Space", role: .destructive) { app.leave() }
        } message: {
            Text("The key is removed from this iPhone. You can join again with the same key.")
        }
    }

    private var footer: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Isbell \(version) (\(build)) · relay \(SpaceStore.relayURL.host() ?? "")"
    }
}

private struct CommandRow: View {
    let command: String

    var body: some View {
        HStack {
            Text(verbatim: command).font(.footnote.monospaced()).textSelection(.enabled)
            Spacer(minLength: 8)
            Button {
                UIPasteboard.general.string = command
            } label: {
                Image(systemName: "doc.on.doc").accessibilityLabel(Text("Copy"))
            }
            .buttonStyle(.borderless)
        }
    }
}
