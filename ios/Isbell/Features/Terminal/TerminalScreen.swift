// A session's terminal, full screen and dark, with the key bar under it, above the keyboard when it is
// up. It holds the pane while shown and lets it go when closed. What is said is pasted at the cursor.
// As web/src/shell/mobile/terminal.tsx.

import IsbellKit
import SwiftUI
import UIKit

struct TerminalScreen: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.scenePhase) private var phase
    @Environment(\.dismiss) private var dismiss
    let placed: Placed
    @State private var model: TerminalModel
    @State private var handle = TermHandle()
    @State private var keyboard = false
    /// What is said into the terminal, pasted at its cursor.
    @State private var voice = VoiceInput()

    init(placed: Placed) {
        self.placed = placed
        _model = State(initialValue: TerminalModel(mid: placed.session.mid, paneId: placed.session.paneId))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                TermView(model: model, space: store.space, handle: handle)
                    .padding(.horizontal, 6)
                overlay
            }
            .background(Color(hex: 0x0d121b))
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let problem = voice.problem {
                        VoiceProblemLine(problem: problem)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.top, 6)
                    }
                    KeyBar(live: model.phase == .open, keyboard: keyboard, press: handle.press,
                           toggleKeyboard: handle.toggleKeyboard, voice: voice, heard: handle.paste)
                }
                .background(Color(hex: 0x161c27))
            }
            .navigationTitle(placedTitle(placed))
            .navigationSubtitle(Text("Terminal · \(placedWhere(placed))"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", systemImage: "chevron.down") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboard = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboard = false
        }
        .onChange(of: Resume(ready: ready, phase: model.phase)) { _, now in
            if now.ready { model.resume(store.space) }
        }
        .onChange(of: phase) { _, now in
            if now == .background { voice.discard() }
        }
        .onDisappear {
            voice.discard()
            model.close()
        }
    }

    private var ready: Bool { phase == .active && store.space.status == .open }

    /// A lost terminal attaches again once it may and the app is ready for it.
    private struct Resume: Equatable {
        let ready: Bool
        let phase: TerminalModel.Phase
    }

    @ViewBuilder private var overlay: some View {
        switch model.phase {
        case .ended where model.waiting && !ready, .opening:
            Text("Opening the terminal…").font(.footnote.monospaced()).foregroundStyle(.secondary)
        case .open:
            EmptyView()
        case .ended:
            VStack(alignment: .leading, spacing: 12) {
                Text("Disconnected").font(.headline)
                if let error = model.error { Text(verbatim: error.msg).font(.footnote).foregroundStyle(.secondary) }
                Button("Reconnect") { model.reconnect(store.space) }.buttonStyle(.borderedProminent)
            }
            .padding(20)
            .frame(maxWidth: 320, alignment: .leading)
            .background(.regularMaterial, in: .rect(cornerRadius: 16))
        }
    }
}
