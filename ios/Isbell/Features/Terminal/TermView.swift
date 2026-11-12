// The terminal itself: SwiftTerm, dark as on the web, in SF Mono 13. What is typed goes to the
// model, and the view's size is the pane's. A tap brings the keyboard up, as in any terminal.

import IsbellKit
import SwiftTerm
import SwiftUI
import UIKit

struct TermView: UIViewRepresentable {
    let model: TerminalModel
    let space: Space
    let handle: TermHandle

    func makeCoordinator() -> Coordinator { Coordinator(model: model, space: space) }

    func makeUIView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero, font: .monospacedSystemFont(ofSize: 13, weight: .regular))
        view.terminalDelegate = context.coordinator
        view.nativeBackgroundColor = UIColor(Night.background)
        view.nativeForegroundColor = UIColor(Night.foreground)
        view.caretColor = UIColor(Night.caret)
        view.installColors(Night.ansi)
        // herdr answers no colour queries, and agents set colours of their own; as the web, text is
        // kept readable on the background.
        view.minimumContrastRatio = 3
        // herdr streams only the screen, not the modes a program asks for: taps are not reported.
        view.allowMouseReporting = false
        // The key bar under the terminal stands in for SwiftTerm's own.
        view.inputAccessoryView = nil
        handle.view = view
        model.screen = { [weak view] bytes in view?.feed(byteArray: ArraySlice(bytes)) }
        return view
    }

    func updateUIView(_ view: TerminalView, context: Context) {}

    static func dismantleUIView(_ view: TerminalView, coordinator: Coordinator) {
        coordinator.model.screen = nil
    }

    @MainActor
    final class Coordinator: TerminalViewDelegate {
        let model: TerminalModel
        let space: Space

        init(model: TerminalModel, space: Space) {
            self.model = model
            self.space = space
        }

        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            guard newCols > 0, newRows > 0 else { return }
            model.sized(space, TermSize(cols: newCols, rows: newRows))
        }

        func send(source: TerminalView, data: ArraySlice<UInt8>) {
            model.input(Data(data))
        }

        func setTerminalTitle(source: TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func scrolled(source: TerminalView, position: Double) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}

/// What the key bar does to the terminal: keys sent as typed, words said pasted, and the keyboard
/// shown or put away.
@MainActor
final class TermHandle {
    fileprivate weak var view: TerminalView?

    func press(_ key: BarKey) {
        guard let view else { return }
        if let bytes = key.bytes { return view.send(data: ArraySlice(bytes)) }
        // Arrows follow the cursor-key mode the program asked for, which SwiftTerm knows.
        key == .up ? view.sendKeyUp() : view.sendKeyDown()
    }

    /// `text` at the cursor, as a paste: Enter sends it.
    func paste(_ text: String) {
        view?.pasteText(text)
    }

    func toggleKeyboard() {
        guard let view else { return }
        _ = view.isFirstResponder ? view.resignFirstResponder() : view.becomeFirstResponder()
    }
}

/// The web's dark terminal palette (web/src/features/session/use-terminal.ts).
private enum Night {
    static let background = SwiftUI.Color(hex: 0x0d121b)
    static let foreground = SwiftUI.Color(hex: 0xe9e5d9)
    static let caret = SwiftUI.Color(hex: 0x8fb0ff)
    static let ansi: [SwiftTerm.Color] = [
        0x283143, 0xf08a80, 0x6fd39a, 0xe6b45e, 0x8fb0ff, 0xd39be0, 0x7fc8cf, 0xc9c5ba,
        0x2a303c, 0xffa69d, 0x8fe3b2, 0xf2c77c, 0xadc6ff, 0xe3b5ec, 0x9edbe1, 0xe9e5d9,
    ].map { SwiftTerm.Color(red8: UInt16($0 >> 16), green8: UInt16(($0 >> 8) & 0xff), blue8: UInt16($0 & 0xff)) }
}

extension SwiftUI.Color {
    init(hex: UInt32) {
        self.init(red: Double(hex >> 16) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}
