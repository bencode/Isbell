// The key, or a `#k=` link, pasted or typed; checked as it changes.

import IsbellKit
import os
import SwiftUI
import UIKit

struct PasteKeyView: View {
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var saveFailed = false
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                TextField("isbk1-…", text: $text)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.join)
                    .onSubmit(join)
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    check
                    Text("The key stays in this iPhone's Keychain and on your machines. There is no account.")
                }
            }
            Section {
                Button("Join", action: join).disabled(identity == nil)
            }
        }
        .navigationTitle("Paste Key")
        .onAppear {
            fillFromPasteboard()
            focused = true
        }
    }

    @ViewBuilder private var check: some View {
        if saveFailed {
            Label("Could not save the key on this iPhone.", systemImage: "xmark.octagon").foregroundStyle(.red)
        } else {
            switch parse(text) {
            case nil: EmptyView()
            case .success: Label("The key is complete.", systemImage: "checkmark.circle").foregroundStyle(.green)
            case .failure(let error): Label(message(error), systemImage: "exclamationmark.circle").foregroundStyle(.red)
            }
        }
    }

    private var identity: Identity? {
        if case .success(let id)? = parse(text) { id } else { nil }
    }

    private func join() {
        guard let identity else { return }
        do {
            try app.join(identity)
        } catch {
            logger.error("could not save the space key: \(error.status)")
            saveFailed = true
        }
    }

    /// iOS asks once before the app reads what another app copied.
    private func fillFromPasteboard() {
        guard text.isEmpty, UIPasteboard.general.hasStrings, let pasted = UIPasteboard.general.string,
              case .success? = parse(pasted)
        else { return }
        text = pasted
    }
}

/// Nil while there is nothing to check.
private func parse(_ text: String) -> Result<Identity, KeyError>? {
    let key = keyText(fromPasted: text)
    guard !key.isEmpty else { return nil }
    return Result { () throws(KeyError) in try parseKey(key) }
}

private func message(_ error: KeyError) -> LocalizedStringKey {
    switch error {
    case .prefix: "A space key starts with isbk1-."
    case .encoding: "That is not a whole key. Check for a missing character."
    case .checksum: "That key failed its checksum. Check for a mistyped character."
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "join")
