// A reply to the agent, typed as into its terminal, with the files added for it where its machine
// takes them: their paths there follow the words. While it works and nothing is written, the button
// stops it with the key it stops on. As web/src/features/session/composer.tsx.

import IsbellKit
import SwiftUI

struct ReplyBar: View {
    @Environment(SpaceStore.self) private var store
    let session: Session
    /// The page's: what is written stays while the agent asks and the bar is away.
    @Binding var draft: String
    /// The page's, as the draft is.
    let attachments: Attachments
    let onSent: (String) -> Void
    @State private var sending = false
    @State private var stopping = false
    @State private var error: CallError?

    var body: some View {
        let message = ([draft.trimmingCharacters(in: .whitespacesAndNewlines)] + attachments.paths)
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        VStack(alignment: .leading, spacing: 6) {
            if let error {
                Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red).padding(.horizontal, 8)
            }
            if !attachments.items.isEmpty { AttachmentChips(attachments: attachments) }
            HStack(alignment: .bottom, spacing: 8) {
                if takesFiles { AttachMenu(attachments: attachments) }
                TextField("Reply…", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)
                    .glassEffect(.regular, in: .rect(cornerRadius: 24))
                if message.isEmpty && !attachments.uploading && session.status == .working {
                    button("Stop", systemImage: "square.fill", disabled: stopping) { await stop() }
                } else {
                    button("Send", systemImage: "arrow.up", disabled: message.isEmpty || sending || attachments.uploading) {
                        await send(message)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    /// The gateway of the agent's machine takes files.
    private var takesFiles: Bool {
        store.space.machines.first { $0.id == session.mid }?.state.caps.methods.contains("isbell.file.upload") ?? false
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
            attachments.clear()
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
