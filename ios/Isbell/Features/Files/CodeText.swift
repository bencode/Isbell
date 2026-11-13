// Text read from a file: monospaced and selectable, its lines numbered and wrapped, colored as its
// language is where there is one and it is not too long to. A UITextView, as SwiftUI's Text does not
// take a file of some megabytes.

import SwiftUI
import UIKit

/// Over this, coloring takes too long to wait for.
private let colorMax = 512 << 10

struct CodeText: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    let language: String?
    @State private var colored: NSAttributedString?

    var body: some View {
        TextPane(text: text, colored: colored)
            .task(id: scheme) {
                guard let language, text.utf8.count <= colorMax else { return }
                colored = await Highlighter.shared.colored(text, language: language, dark: scheme == .dark)?.text
            }
    }
}

private struct TextPane: UIViewRepresentable {
    let text: String
    let colored: NSAttributedString?

    func makeUIView(context: Context) -> CodeView { CodeView() }

    func updateUIView(_ view: CodeView, context: Context) {
        view.show(text: text, colored: colored)
    }
}

/// The text, with a column of line numbers at its left.
final class CodeView: UITextView {
    private let gutter = Gutter()
    /// Where each line starts, in UTF-16 units, as the layout counts them.
    fileprivate private(set) var lineStarts = [0]
    private var shownText: String?
    /// The text uncolored, made once for each text, so that an update with nothing new sets nothing.
    private var plain = NSAttributedString()
    private var shownColored: NSAttributedString?

    init() {
        // TextKit 1, whose line fragments say where to number the lines.
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        // As tall as the text is, as wide as the view.
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        super.init(frame: .zero, textContainer: container)
        isEditable = false
        isSelectable = true
        alwaysBounceVertical = true
        dataDetectorTypes = []
        backgroundColor = UIColor(Palette.bg)
        layoutManager.allowsNonContiguousLayout = true
        gutter.code = self
        gutter.isUserInteractionEnabled = false
        gutter.backgroundColor = UIColor(Palette.bg)
        addSubview(gutter)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a coder") }

    func show(text: String, colored: NSAttributedString?) {
        if text != shownText {
            shownText = text
            lineStarts = [0] + text.utf16.enumerated().compactMap { $0.element == 10 ? $0.offset + 1 : nil }
            let digits = CGFloat(String(lineStarts.count).count)
            textContainerInset = UIEdgeInsets(top: 12, left: gutterWidth(digits) + 8, bottom: 12, right: 10)
            plain = NSAttributedString(string: text, attributes: [
                .font: UIFont.monospacedSystemFont(ofSize: codeSize, weight: .regular), .foregroundColor: UIColor.label,
            ])
        }
        let shown = colored ?? plain
        if shown !== shownColored {
            shownColored = shown
            attributedText = shown
        }
    }

    /// The line `index` starts, counted from 1; nil where no line starts there.
    fileprivate func line(startingAt index: Int) -> Int? {
        var low = 0, high = lineStarts.count - 1
        while low <= high {
            let mid = (low + high) / 2
            if lineStarts[mid] == index { return mid + 1 }
            if lineStarts[mid] < index { low = mid + 1 } else { high = mid - 1 }
        }
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Over the part in view, drawn again as it moves.
        gutter.frame = CGRect(x: 0, y: contentOffset.y, width: textContainerInset.left - 8,
                              height: bounds.height)
        bringSubviewToFront(gutter)
        gutter.setNeedsDisplay()
    }
}

private let numberFont = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)

private func gutterWidth(_ digits: CGFloat) -> CGFloat {
    ("0" as NSString).size(withAttributes: [.font: numberFont]).width * max(digits, 2) + 14
}

/// The numbers of the lines in view, each where its first line fragment is.
private final class Gutter: UIView {
    weak var code: CodeView?

    override func draw(_ rect: CGRect) {
        guard let code else { return }
        let layout = code.layoutManager
        let inset = code.textContainerInset
        let top = code.contentOffset.y - inset.top
        let glyphs = layout.glyphRange(forBoundingRect: CGRect(x: 0, y: top, width: code.textContainer.size.width,
                                                               height: bounds.height),
                                       in: code.textContainer)
        let attributes: [NSAttributedString.Key: Any] = [.font: numberFont, .foregroundColor: UIColor.tertiaryLabel]
        layout.enumerateLineFragments(forGlyphRange: glyphs) { fragment, _, _, range, _ in
            guard let number = code.line(startingAt: layout.characterIndexForGlyph(at: range.location)) else { return }
            let label = "\(number)" as NSString
            let size = label.size(withAttributes: attributes)
            label.draw(at: CGPoint(x: self.bounds.width - size.width - 6,
                                   y: fragment.minY - top + (fragment.height - size.height) / 2),
                       withAttributes: attributes)
        }
        UIColor.separator.setFill()
        UIRectFill(CGRect(x: bounds.width - 0.5, y: 0, width: 0.5, height: bounds.height))
    }
}
