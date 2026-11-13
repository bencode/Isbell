// A file of a project read: Markdown as it is meant to look, an HTML page or SVG as a browser shows
// it, code colored where it is other text, an image to zoom where it is one; else what it is. Read
// again as it shows again, sent again only if it changed. As web/src/shell/mobile/files/reader.tsx;
// Mermaid reads as code for now.

import CoreTransferable
import IsbellKit
import SwiftUI
import UniformTypeIdentifiers

struct FileRoute: Hashable {
    let mid: String
    let path: String
    /// From the root it was opened in.
    let rel: String

    /// The folder it was opened in.
    var root: String {
        let root = String(path.dropLast(rel.count))
        return root.count > 1 && root.hasSuffix("/") ? String(root.dropLast()) : root
    }
}

/// Over this, a Markdown file reads as code: laid out, it takes too long.
private let markdownMax = 512 << 10

struct FileView: View {
    @Environment(SpaceStore.self) private var store
    @Environment(\.scenePhase) private var phase
    let route: FileRoute
    @State private var read: FileRead?
    /// How it shows, worked out once for each read.
    @State private var shown: Shown?
    /// Counts the reads that changed it, for what it shows to start over.
    @State private var version = 0
    /// The last read failed; what was read before stays.
    @State private var error: CallError?
    @State private var reading = false
    /// The files what is read shows beside itself, read again as it is.
    @State private var assets: FileAssets?
    /// A file a link in it goes to, opened.
    @State private var link: FileRoute?

    private enum Shown {
        case markdown(String)
        case page(Data)
        case text(String)
        case image(UIImage)
        case nothing
    }

    private var name: String { nameOf(route.rel) }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.bg)
            .safeAreaInset(edge: .top) {
                if let error, read != nil {
                    Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
                }
            }
            .navigationTitle(Text(verbatim: name))
            .navigationSubtitle(Text(verbatim: dirOf(route.rel)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarVisibility(.hidden, for: .tabBar)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { menu } }
            .navigationDestination(item: $link) { FileView(route: $0) }
            // Each time it shows: on coming back to its tab, as when it first does.
            .task { await load(fresh: false) }
            .onChange(of: phase) { _, now in
                if now == .active { Task { await load(fresh: false) } }
            }
    }

    @ViewBuilder private var content: some View {
        switch shown {
        case .markdown(let text):
            if let assets { MarkdownFile(text: text, route: route, assets: assets) { link = $0 }.id(version) }
        case .page(let page):
            if let assets { PageFile(rel: route.rel, first: page, assets: assets).id(version) }
        case .text(let text):
            CodeText(text: text, language: codeLanguage(name)).id(version)
        case .image(let image):
            VStack(spacing: 8) {
                ZoomImage(image: image).id(version)
                (Text("\(Int(image.size.width)) × \(Int(image.size.height))") + Text(verbatim: " · ")
                    + Text(Int64(read?.size ?? 0), format: .byteCount(style: .file)))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 8)
            }
        case .nothing:
            ContentUnavailableView("No preview", systemImage: "doc",
                                   description: Text(Int64(read?.size ?? 0), format: .byteCount(style: .file)))
        case nil:
            if let error {
                ContentUnavailableView("The file can't be read", systemImage: "doc.questionmark",
                                       description: Text(verbatim: error.msg))
            } else {
                ProgressView()
            }
        }
    }

    private var menu: some View {
        Menu("More", systemImage: "ellipsis.circle") {
            Button("Copy path", systemImage: "doc.on.doc") { UIPasteboard.general.string = route.path }
            Button("Reload", systemImage: "arrow.clockwise") { Task { await load(fresh: true) } }
            if let bytes = read?.bytes {
                ShareLink(item: SharedFile(name: name, data: bytes), preview: SharePreview(name))
            }
        }
    }

    /// Reads it; unless `fresh`, a file as it was is not sent again.
    private func load(fresh: Bool) async {
        guard !reading else { return }
        reading = true
        defer { reading = false }
        do throws(CallError) {
            let next = try await readFile(store.space.open, mid: route.mid, path: route.path, limit: previewMax,
                                          previous: fresh ? nil : read)
            error = nil
            guard fresh || next != read else { return }
            read = next
            assets = FileAssets(open: store.space.open, mid: route.mid, root: route.root)
            shown = shownOf(next)
            version += 1
        } catch {
            self.error = error
        }
    }

    private func shownOf(_ file: FileRead) -> Shown {
        guard let bytes = file.bytes else { return .nothing }
        let ext = (name as NSString).pathExtension.lowercased()
        if ["html", "htm", "svg"].contains(ext) { return .page(bytes) }
        if ["md", "markdown"].contains(ext), bytes.count <= markdownMax, let text = decodeText(bytes) {
            return .markdown(text)
        }
        if imageType(name) != nil { return UIImage(data: bytes).map(Shown.image) ?? .nothing }
        return decodeText(bytes).map(Shown.text) ?? .nothing
    }
}

/// A file read, handed over as it is shared.
private struct SharedFile: Transferable {
    let name: String
    let data: Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .data) { $0.data }.suggestedFileName { $0.name }
    }
}

/// Reads the files under a root that a document shows beside itself: each once, and only a few at a
/// time, since the gateway allows a connection 8 streams and terminals and chats need theirs. As
/// web/src/model/files/assets.ts.
final class FileAssets {
    private static let atOnce = 3
    private let open: Opener
    private let mid: String
    private let root: String
    private var reads: [String: Task<Result<Data, CallError>, Never>] = [:]
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    init(open: @escaping Opener, mid: String, root: String) {
        self.open = open
        self.mid = mid
        self.root = root
    }

    /// The file at `rel` under the root; a file larger than the preview limit throws `too_large`.
    func data(_ rel: String) async throws(CallError) -> Data {
        if let known = reads[rel] { return try await known.value.get() }
        let read = Task { await readOne(rel) }
        reads[rel] = read
        return try await read.value.get()
    }

    private func readOne(_ rel: String) async -> Result<Data, CallError> {
        if running < Self.atOnce {
            running += 1
        } else {
            // A slot freed goes straight to the next read waiting, so none can slip in between.
            await withCheckedContinuation { waiting.append($0) }
        }
        defer {
            if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
        }
        do throws(CallError) {
            let file = try await readFile(open, mid: mid, path: joinPath(root, rel), limit: previewMax)
            guard let bytes = file.bytes else { return .failure(CallError(code: "too_large", msg: "\(rel) is larger than the preview limit")) }
            return .success(bytes)
        } catch {
            return .failure(error)
        }
    }
}
