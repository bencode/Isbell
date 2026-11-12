// The keys a phone keyboard lacks, in the web's order (web/src/shell/mobile/key-bar.tsx): Esc 1 2 3
// ⇧Tab PgUp PgDn Tab ^C scroll, ^C last as a second press quits an agent; 🎤 ⌨ ↑ ↓ ⏎ stay in reach.
// While recording, the bar is the recording's.

import SwiftUI

enum BarKey: Hashable {
    case esc, one, two, three, backTab, pageUp, pageDown, tab, interrupt, up, down, enter

    /// What the key sends; nil for the arrows, which the terminal sends in the cursor-key mode the
    /// program asked for.
    var bytes: Data? {
        let text: String? =
            switch self {
            case .esc: "\u{1b}"
            case .one: "1"
            case .two: "2"
            case .three: "3"
            case .backTab: "\u{1b}[Z"
            case .pageUp: "\u{1b}[5~"
            case .pageDown: "\u{1b}[6~"
            case .tab: "\t"
            case .interrupt: "\u{03}"
            case .up, .down: nil
            case .enter: "\r"
            }
        return text.map { Data($0.utf8) }
    }
}

struct KeyBar: View {
    let live: Bool
    let keyboard: Bool
    let press: (BarKey) -> Void
    let toggleKeyboard: () -> Void
    let voice: VoiceInput
    /// Where the words said go.
    let heard: (String) -> Void

    private static let scrolled: [(BarKey, String)] = [
        (.esc, "Esc"), (.one, "1"), (.two, "2"), (.three, "3"), (.backTab, "⇧Tab"),
        (.pageUp, "PgUp"), (.pageDown, "PgDn"), (.tab, "Tab"), (.interrupt, "^C"),
    ]

    var body: some View {
        HStack(spacing: 6) {
            switch voice.state {
            case .idle: keys
            case .recording: recording
            case .working: transcribing
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 6)
        .background(KeyStyle.bar)
    }

    @ViewBuilder private var keys: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(Self.scrolled, id: \.0) { key, label in
                    KeyButton(label: Text(verbatim: label)) { press(key) }
                }
            }
            .padding(.leading, 8)
        }
        .scrollIndicators(.hidden)
        .disabled(!live)
        Divider().frame(height: 28).overlay(KeyStyle.line)
        Group {
            KeyButton(label: Image(systemName: "mic")) { Task { await voice.start(onText: heard) } }
                .accessibilityLabel(Text("Voice input"))
            KeyButton(label: Image(systemName: "keyboard"), on: keyboard, action: toggleKeyboard)
                .accessibilityLabel(Text("Keyboard"))
            KeyButton(label: Image(systemName: "arrow.up")) { press(.up) }
            KeyButton(label: Image(systemName: "arrow.down")) { press(.down) }
            KeyButton(label: Image(systemName: "return"), accent: true) { press(.enter) }
                .padding(.trailing, 8)
        }
        .disabled(!live)
    }

    /// Drop it, how it sounds, or send it to be recognised.
    @ViewBuilder private var recording: some View {
        KeyButton(label: Image(systemName: "xmark"), alarm: true) { voice.discard() }
            .accessibilityLabel(Text("Discard recording"))
            .padding(.leading, 8)
        VoiceMeter(voice: voice, ink: KeyStyle.text)
            .padding(.horizontal, 6)
        KeyButton(label: Image(systemName: "checkmark"), accent: true) { voice.finish() }
            .accessibilityLabel(Text("Stop recording"))
            .padding(.trailing, 8)
    }

    private var transcribing: some View {
        HStack(spacing: 10) {
            ProgressView().tint(KeyStyle.text)
            Text("Transcribing…")
        }
        .font(.system(size: 14, design: .monospaced))
        .foregroundStyle(KeyStyle.text)
        .frame(maxWidth: .infinity)
    }
}

private struct KeyButton<Label: View>: View {
    let label: Label
    var on = false
    var accent = false
    /// Drops what is under way.
    var alarm = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 15, weight: .medium, design: .monospaced))
                .foregroundStyle(accent ? KeyStyle.accentText : alarm ? KeyStyle.alarm : KeyStyle.text)
                .frame(minWidth: accent ? 52 : 40, minHeight: 44)
                .padding(.horizontal, 4)
                .background(accent ? KeyStyle.accent : on ? KeyStyle.on : KeyStyle.key, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? KeyStyle.accent : alarm ? KeyStyle.alarm : KeyStyle.line))
        }
        .buttonStyle(.plain)
    }
}

/// The key bar's colours, as the web's (web/src/shell/mobile/key-bar.tsx).
private enum KeyStyle {
    static let bar = Color(hex: 0x161c27)
    static let key = Color(hex: 0x1f2737)
    static let line = Color(hex: 0x2c3546)
    static let on = Color(hex: 0x2b3a5c)
    static let text = Color(hex: 0xd8dce6)
    static let accent = Color(hex: 0x8fb0ff)
    static let accentText = Color(hex: 0x0c1018)
    static let alarm = Color(hex: 0xff8a80)
}
