// What was searched for, shown where it was found.

import Foundation

/// `text` with each place it holds `needle` in bold, ignoring case.
func marked(_ text: String, _ needle: String) -> AttributedString {
    var shown = AttributedString(text)
    guard !needle.isEmpty else { return shown }
    var from = shown.startIndex
    while let found = shown[from...].range(of: needle, options: .caseInsensitive) {
        shown[found].inlinePresentationIntent = .stronglyEmphasized
        from = found.upperBound
    }
    return shown
}
