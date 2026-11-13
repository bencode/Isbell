// What a live session is and where it runs, and how to take it over in a terminal of one's own.
// As the session and machine groups of web/src/features/session/facts.ts; how the machine is reached
// is in its own info.

import IsbellKit
import SwiftUI

struct SessionInfoSheet: View {
    @Environment(\.dismiss) private var dismiss
    let placed: Placed

    var body: some View {
        let session = placed.session
        let project = placed.project
        NavigationStack {
            List {
                Group {
                    Section("Session") {
                        LabeledContent("Agent") { Text(verbatim: session.kind ?? "—") }
                        LabeledContent("Status") {
                            HStack(spacing: 4) {
                                statusName(session.status)
                                Text(verbatim: "·")
                                Elapsed(since: session.statusSince)
                            }
                        }
                        LabeledContent("Pane") { Text(verbatim: session.paneId).monospaced() }
                    }
                    Section("Machine") {
                        LabeledContent("Name") { Text(verbatim: project.machine) }
                        LabeledContent("Status") { project.online ? Text("Online") : Text("Offline") }
                        LabeledContent("Directory") { Text(verbatim: project.display).monospaced() }
                    }
                    Section {
                        Takeover(command: attachCommand(placed))
                    } header: {
                        Text("Take it over in your own terminal")
                    } footer: {
                        Text("It takes the terminal over and this disconnects. Without --control --takeover it only watches.")
                    }
                }
                .listRowBackground(Palette.raised)
            }
            .paletteList()
            .navigationTitle("Session info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func statusName(_ status: AgentStatus) -> Text {
        switch status {
        case .blocked: Text("Asking you")
        case .working: Text("Working")
        case .done: Text("Just finished")
        case .idle, .unknown: Text("Standing by")
        }
    }
}

/// The command, in a terminal's colors, to copy.
private struct Takeover: View {
    let command: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(verbatim: command)
                .font(.caption.monospaced())
                .foregroundStyle(Color(hex: 0xe9e5d9))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = command }
                .labelStyle(.iconOnly)
                .foregroundStyle(Color(hex: 0x8fb0ff))
        }
        .padding(10)
        .background(Color(hex: 0x0d121b), in: .rect(cornerRadius: 10))
    }
}

/// How to reach the pane by hand, as web/src/features/session/facts.ts `attachCommand`: an agent by its
/// name in herdr, else by its pane. It takes the pane over, since herdr lets one client hold it.
private func attachCommand(_ placed: Placed) -> String {
    let target = "\(placed.project.machine)/\(placed.session.herdrName ?? placed.session.paneId)"
    return "isbell terminal attach --control --takeover \(shellArg(target))"
}

/// `value` as one shell word, quoted only when it needs to be. As web/src/utils/shell.ts.
private func shellArg(_ value: String) -> String {
    if value.wholeMatch(of: /[\w@%+=:,.\/~-]+/.asciiOnlyWordCharacters()) != nil { return value }
    return "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
}
