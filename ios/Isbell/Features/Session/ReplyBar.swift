// A reply to the agent, typed as into its terminal; while it works and nothing is written, the
// button stops it with the key it stops on. As web/src/features/session/composer.tsx, without files.

import IsbellKit
import SwiftUI

struct ReplyBar: View {
    @Environment(SpaceStore.self) private var store
    let session: Session
    /// The page's: what is written stays while the agent asks and the bar is away.
    @Binding var draft: String
    let onSent: (String) -> Void
    @State private var sending = false
    @State private var stopping = false
    @State private var error: CallError?

    var body: some View {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        VStack(alignment: .leading, spacing: 6) {
            if let error {
                Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red).padding(.horizontal, 8)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Reply…", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)
                    .glassEffect(.regular, in: .rect(cornerRadius: 24))
                if text.isEmpty && session.status == .working {
                    button("Stop", systemImage: "square.fill", disabled: stopping) { await stop() }
                } else {
                    button("Send", systemImage: "arrow.up", disabled: text.isEmpty || sending) { await send(text) }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func button(_ label: LocalizedStringKey, systemImage: String, disabled: Bool,
                        action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Label(label, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .disabled(disabled)
    }

    private func send(_ text: String) async {
        // A second tap can come before the button shows it is disabled.
        guard !sending else { return }
        sending = true
        defer { sending = false }
        do throws(CallError) {
            try await prompt(store.call, mid: session.mid, paneId: session.paneId, text: text)
            draft = ""
            error = nil
            onSent(text)
        } catch {
            self.error = error
        }
    }

    private func stop() async {
        guard !stopping else { return }
        stopping = true
        defer { stopping = false }
        do throws(CallError) {
            try await sendKeys(store.call, mid: session.mid, paneId: session.paneId, keys: ["esc"])
            error = nil
        } catch {
            self.error = error
        }
    }
}
