// Code colored as highlight.js does, through Highlightr, off the main thread: one JavaScript context,
// coloring one file at a time.

import Highlightr
import UIKit
import os

actor Highlighter {
    static let shared = Highlighter()
    private let highlightr = Highlightr()
    private var theme: String?

    /// `code` in `language`'s colors on a light or a dark page; nil where it cannot be colored.
    func colored(_ code: String, language: String, dark: Bool) -> Colored? {
        guard let highlightr else {
            logger.error("highlight.js could not be loaded")
            return nil
        }
        let name = dark ? "atom-one-dark" : "xcode"
        if theme != name {
            guard highlightr.setTheme(to: name) else {
                logger.error("no theme \(name)")
                return nil
            }
            highlightr.theme.setCodeFont(.monospacedSystemFont(ofSize: codeSize, weight: .regular))
            theme = name
        }
        return highlightr.highlight(code, as: language).map(Colored.init)
    }
}

/// Code colored. An NSAttributedString is not changed once made, so it is safe to hand across.
nonisolated struct Colored: @unchecked Sendable {
    let text: NSAttributedString
}

nonisolated let codeSize: CGFloat = 13

nonisolated private let logger = Logger(subsystem: "dev.fmap.isbell", category: "highlight")
