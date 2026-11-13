// Isbell's colors, light and dark, as the web's tokens in web/src/styles.css: the ground of a page,
// what is raised on it, its lines, and the colors that say what a session does. Text keeps the
// system's colors.

import SwiftUI
import UIKit

enum Palette {
    /// The ground of a page.
    static let bg = adaptive(0xf3f0e8, 0x10151f)
    /// Cards and the rows of a list.
    static let raised = adaptive(0xfffdf8, 0x171d2a)
    /// What sits a step below a card: a tool's output, a label.
    static let raised2 = adaptive(0xece7db, 0x1f2737)
    static let line = adaptive(0xdcd5c4, 0x283143)
    /// Links, buttons, and an agent at work.
    static let accent = adaptive(0x1f4fd1, 0x8fb0ff)
    /// Under a path in the chat.
    static let accentSoft = adaptive(0xe2e8fa, 0x1c2747)
    /// Finished, online, lines added.
    static let ok = adaptive(0x2f7d4f, 0x6fd39a)
    /// Asking, reconnecting.
    static let warn = adaptive(0x985a12, 0xe6b45e)
    /// Failed, lines removed, ending.
    static let danger = adaptive(0xb3261e, 0xf08a80)
    /// The ground and the line of a card that asks.
    static let ask = adaptive(0xfdf3dc, 0x221e16)
    static let askLine = adaptive(0xdcb56d, 0x6a5426)
}

/// Nonisolated, as SwiftUI resolves a color off the main thread too while it animates (#138).
private nonisolated func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
}

private nonisolated func rgb(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

extension View {
    /// A List or Form on the page's ground; its rows are raised with `.listRowBackground(Palette.raised)`.
    func paletteList() -> some View {
        scrollContentBackground(.hidden).background(Palette.bg)
    }
}
