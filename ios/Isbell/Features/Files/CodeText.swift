// Text read from a file, as it is: monospaced, selectable, its lines wrapped. A UITextView, as
// SwiftUI's Text does not take a file of some megabytes.

import SwiftUI
import UIKit

struct CodeText: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        view.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        view.alwaysBounceVertical = true
        view.dataDetectorTypes = []
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}
