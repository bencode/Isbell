// A file of a project read: as code, colored, where it is text; as an image to zoom where it is one;
// else what it is. Read again as it shows again, sent again only if it changed. As
// web/src/shell/mobile/files/reader.tsx; Markdown, HTML and Mermaid read as code for now.

import CoreTransferable
import IsbellKit
import SwiftUI
import UniformTypeIdentifiers

struct FileRoute: Hashable {
    let mid: String
    let path: String
    /// From the root it was opened in.
    let rel: String
}

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

    private enum Shown {
        case text(String)
        case image(UIImage)
        case nothing
    }

    private var name: String { nameOf(route.rel) }

    var body: some View {
        content
            .safeAreaInset(edge: .top) {
                if let error, read != nil {
                    Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
                }
            }
            .navigationTitle(Text(verbatim: name))
            .navigationSubtitle(Text(verbatim: dirOf(route.rel)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { menu } }
            // Each time it shows: on coming back to its tab, as when it first does.
            .task { await load(fresh: false) }
            .onChange(of: phase) { _, now in
                if now == .active { Task { await load(fresh: false) } }
            }
    }

    @ViewBuilder private var content: some View {
        switch shown {
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
            shown = shownOf(next)
            version += 1
        } catch {
            self.error = error
        }
    }

    private func shownOf(_ file: FileRead) -> Shown {
        guard let bytes = file.bytes else { return .nothing }
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
