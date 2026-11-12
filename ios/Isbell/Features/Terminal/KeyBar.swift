// The keys a phone keyboard lacks, in the web's order (web/src/shell/mobile/key-bar.tsx): Esc 1 2 3
// ⇧Tab PgUp PgDn Tab ^C scroll, ^C last as a second press quits an agent; ⌨ ↑ ↓ ⏎ stay in reach.

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

    private static let scrolled: [(BarKey, String)] = [
        (.esc, "Esc"), (.one, "1"), (.two, "2"), (.three, "3"), (.backTab, "⇧Tab"),
        (.pageUp, "PgUp"), (.pageDown, "PgDn"), (.tab, "Tab"), (.interrupt, "^C"),
    ]

    var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Self.scrolled, id: \.0) { key, label in
                        KeyButton(label: Text(verbatim: label)) { press(key) }
                    }
                }
                .padding(.leading, 8)
            }
            .scrollIndicators(.hidden)
            Divider().frame(height: 28).overlay(KeyStyle.line)
            KeyButton(label: Image(systemName: "keyboard"), on: keyboard, action: toggleKeyboard)
                .accessibilityLabel(Text("Keyboard"))
            KeyButton(label: Image(systemName: "arrow.up")) { press(.up) }
            KeyButton(label: Image(systemName: "arrow.down")) { press(.down) }
            KeyButton(label: Image(systemName: "return"), accent: true) { press(.enter) }
                .padding(.trailing, 8)
        }
        .padding(.vertical, 6)
        .background(KeyStyle.bar)
        .disabled(!live)
    }
}

private struct KeyButton<Label: View>: View {
    let label: Label
    var on = false
    var accent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 15, weight: .medium, design: .monospaced))
                .foregroundStyle(accent ? KeyStyle.accentText : KeyStyle.text)
                .frame(minWidth: accent ? 52 : 40, minHeight: 44)
                .padding(.horizontal, 4)
                .background(accent ? KeyStyle.accent : on ? KeyStyle.on : KeyStyle.key, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? KeyStyle.accent : KeyStyle.line))
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
}
