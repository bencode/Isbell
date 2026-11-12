// A reply to the agent, typed as into its terminal, with the files added for it where its machine
// takes them: their paths there follow the words. While it works and nothing is written, the button
// stops it with the key it stops on. What is said goes under what is written, on a line of its own.
// As web/src/features/session/composer.tsx.

import IsbellKit
import SwiftUI

struct ReplyBar: View {
    @Environment(SpaceStore.self) private var store
    let session: Session
    /// The page's: what is written stays while the agent asks and the bar is away.
    @Binding var draft: String
    /// The page's, as the draft is.
    let attachments: Attachments
    /// The page's, as the draft is: what is said still lands while the agent asks.
    let voice: VoiceInput
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
            if let problem = voice.problem { VoiceProblemLine(problem: problem).padding(.horizontal, 8) }
            if !attachments.items.isEmpty { AttachmentChips(attachments: attachments) }
            HStack(alignment: .bottom, spacing: 8) {
                if voice.state == .recording {
                    recording
                } else {
                    if takesFiles { AttachMenu(attachments: attachments).disabled(voice.state == .working) }
                    if voice.state == .working { transcribing } else { field }
                    if message.isEmpty && !attachments.uploading && session.status == .working && voice.state == .idle {
                        button("Stop", systemImage: "square.fill", disabled: stopping) { await stop() }
                    } else {
                        button("Send", systemImage: "arrow.up",
                               disabled: message.isEmpty || sending || attachments.uploading || voice.state != .idle) {
                            await send(message)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: 0) {
            TextField("Reply…", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .padding(.leading, 18)
                .padding(.vertical, 13)
            Button {
                Task { await voice.start(onText: heard) }
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 18))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
            }
            .accessibilityLabel(Text("Voice input"))
            .padding(4)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }

    /// The bar while recording: drop it, how it sounds, or send it to be recognised.
    private var recording: some View {
        Group {
            Button("Discard recording", systemImage: "xmark") { voice.discard() }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            VoiceMeter(voice: voice, ink: .primary)
                .padding(.horizontal, 16)
                .frame(height: 48)
                .glassEffect(.regular, in: .capsule)
            button("Stop recording", systemImage: "checkmark", disabled: false) { voice.finish() }
        }
    }

    private var transcribing: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text("Transcribing…")
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }

    /// What is said goes under what is written, on a line of its own.
    private func heard(_ said: String) {
        draft = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? said
            : draft.replacing(/\s+$/, with: "") + "\n" + said
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
