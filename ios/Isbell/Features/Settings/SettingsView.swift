// Settings, a sheet from the projects tab: the look, and the space: how to add a machine, its key,
// and leaving it.

import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(SpaceStore.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
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
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Language")
                                Text("Set per app in iOS Settings").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.forward").foregroundStyle(.tertiary)
                        }
                    }
                    .tint(.primary)
                }
                Section {
                    NavigationLink { AddMachine() } label: {
                        SettingRow(icon: "desktopcomputer", tone: .accent, title: "Add a machine",
                                   note: "Run two commands on a machine with herdr installed.")
                    }
                    NavigationLink { SpaceKey() } label: {
                        SettingRow(icon: "key", title: "Space key", note: "The key is kept only on this iPhone.")
                    }
                    Button(role: .destructive) { confirmingLeave = true } label: {
                        SettingRow(icon: "rectangle.portrait.and.arrow.right", tone: .danger, title: "Leave Space")
                    }
                } header: {
                    Text("Space")
                } footer: {
                    Text(verbatim: footer).frame(maxWidth: .infinity).padding(.top, 16)
                }
            }
            .listRowBackground(Palette.raised)
        }
        .paletteList()
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button(role: .confirm) { dismiss() } }
        }
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

/// A row of settings: its icon in a tile, its title, and what it is under it.
private struct SettingRow: View {
    enum Tone { case plain, accent, danger }

    let icon: String
    var tone = Tone.plain
    let title: LocalizedStringKey
    var note: LocalizedStringKey?

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tone == .accent ? Palette.accent : tone == .danger ? Palette.danger : .secondary)
                .frame(width: 30, height: 30)
                .background(tone == .accent ? Palette.accentSoft : Palette.raised2, in: .rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(tone == .danger ? Palette.danger : .primary)
                if let note { Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
        }
    }
}

/// The two commands that add a machine to the space.
private struct AddMachine: View {
    var body: some View {
        Form {
            Section {
                CommandRow(command: "curl -fsSL https://isbell.fmap.dev/install.sh | sh")
                CommandRow(command: "isbell gateway")
            } footer: {
                Text("Run these two on a machine with herdr installed.")
            }
            .listRowBackground(Palette.raised)
        }
        .paletteList()
        .navigationTitle("Add a machine")
    }
}

/// The space's key, copied to join it elsewhere; never shown.
private struct SpaceKey: View {
    @Environment(SpaceStore.self) private var store

    var body: some View {
        Form {
            Section {
                Button("Copy Space Key", systemImage: "doc.on.doc") { UIPasteboard.general.string = store.identity.key }
            } footer: {
                Text("The key is kept only on this iPhone.")
            }
            .listRowBackground(Palette.raised)
        }
        .paletteList()
        .navigationTitle("Space key")
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
