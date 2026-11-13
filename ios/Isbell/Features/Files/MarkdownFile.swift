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
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        }
        .environment(\.openURL, OpenURLAction { url in
            switch resolveLink(route.rel, url.absoluteString) {
            case .file(let rel):
                open(FileRoute(mid: route.mid, path: joinPath(route.root, rel), rel: rel))
                return .handled
            case .external:
                return .systemAction
            case .anchor, .inert:
                return .discarded
            }
        })
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
