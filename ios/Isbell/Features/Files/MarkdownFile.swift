// A Markdown file read as it is meant to look, as the chat shows Markdown: its images read from the
// root it is in, or from the web; a link to a file under the root opening it, one to the web going
// out to it, and the rest going nowhere. As web/src/shell/mobile/files/reader.tsx.

import IsbellKit
import SwiftUI
import Textual

struct MarkdownFile: View {
    let text: String
    let route: FileRoute
    let assets: FileAssets
    /// Opens a file under the root a link goes to.
    let open: (FileRoute) -> Void

    var body: some View {
        ScrollView {
            StructuredText(markdown: text)
                .textual.textSelection(.enabled)
                .textual.imageAttachmentLoader(FileImages(from: route.rel, assets: assets))
                // Code wraps, as it does where a source file is read.
                .textual.overflowMode(.wrap)
                .textual.codeBlockStyle(PaddedCodeBlock())
                .textual.tableStyle(LinedTable())
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        }
        .environment(\.openURL, OpenURLAction { url in
            switch resolveLink(route.rel, url.absoluteString) {
            case .file(let rel):
                open(FileRoute(mid: route.mid, path: joinPath(route.root, rel), rel: rel, branch: route.branch))
                return .handled
            case .external:
                return .systemAction
            case .anchor, .inert:
                return .discarded
            }
        })
    }
}

/// Textual's code block, with room on its right too: wrapped, its lines would run to the edge. In the
/// palette's colors, as Textual keeps its own to itself.
private struct PaddedCodeBlock: StructuredText.CodeBlockStyle {
    func makeBody(configuration: Configuration) -> some View {
        Overflow {
            configuration.label
                .textual.lineSpacing(.fontScaled(0.39))
                .textual.fontScale(0.882)
                .fixedSize(horizontal: false, vertical: true)
                .monospaced()
                .padding(.vertical, 8)
                .padding(.horizontal, 14)
        }
        .background(Palette.raised)
        .clipShape(.rect(cornerRadius: 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(Palette.line, lineWidth: 1))
        .textual.blockSpacing(.fontScaled(top: 0.88, bottom: 0))
    }
}

/// Textual's table, its lines in the palette's: its own are near white in light and bright in dark.
private struct LinedTable: StructuredText.TableStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .textual.tableCellSpacing(horizontal: 1, vertical: 1)
            .textual.blockSpacing(.fontScaled(top: 1.6, bottom: 1.6))
            .textual.tableOverlay { layout in
                Canvas { context, _ in
                    for divider in layout.dividers() { context.fill(Path(divider), with: .color(Palette.line)) }
                }
            }
            .padding(1)
    }
}

/// The images of the Markdown file at `from`: from the web where they are there, else under the root.
private nonisolated struct FileImages: AttachmentLoader {
    let from: String
    let assets: FileAssets
    private let web: some AttachmentLoader = .image()

    init(from: String, assets: FileAssets) {
        self.from = from
        self.assets = assets
    }

    func attachment(for url: URL, text: String, environment: ColorEnvironmentValues) async throws -> AnyAttachment {
        switch resolveLink(from, url.absoluteString) {
        case .external:
            return AnyAttachment(try await web.attachment(for: url, text: text, environment: environment) as any Textual.Attachment)
        case .file(let rel):
            let data = try await assets.data(rel)
            guard let image = UIImage(data: data) else { throw CallError(code: "bad_image", msg: "\(rel) is not an image") }
            return AnyAttachment(FileImage(rel: rel, image: image, text: text) as any Textual.Attachment)
        case .anchor, .inert:
            throw CallError(code: "not_found", msg: "\(url.absoluteString) is not under the root")
        }
    }
}

/// An image of a file under the root, as wide as it is or as there is room for.
private nonisolated struct FileImage: Attachment {
    let rel: String
    let image: UIImage
    let text: String

    var description: String { text }

    var body: some View {
        Image(uiImage: image).resizable().accessibilityLabel(Text(verbatim: text))
    }

    func sizeThatFits(_ proposal: ProposedViewSize, in _: TextEnvironmentValues) -> CGSize {
        let size = image.size
        guard let room = proposal.width, size.width > 0 else { return size }
        let width = min(room, size.width)
        return CGSize(width: width, height: width * size.height / size.width)
    }

    static func == (a: Self, b: Self) -> Bool { a.rel == b.rel && a.image === b.image }

    func hash(into hasher: inout Hasher) { hasher.combine(rel) }
}
