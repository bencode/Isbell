// A file of a project read: as text where it is some, else what it is. A5b reads it more ways.

import IsbellKit
import SwiftUI

struct FileRoute: Hashable {
    let mid: String
    let path: String
    /// From the root it was opened in.
    let rel: String
}

struct FileView: View {
    @Environment(SpaceStore.self) private var store
    let route: FileRoute
    @State private var read: Result<FileRead, CallError>?

    var body: some View {
        content
            .navigationTitle(Text(verbatim: nameOf(route.rel)))
            .navigationSubtitle(Text(verbatim: dirOf(route.rel)))
            .navigationBarTitleDisplayMode(.inline)
            .task {
                do throws(CallError) {
                    read = .success(try await readFile(store.space.open, mid: route.mid, path: route.path, limit: previewMax))
                } catch {
                    read = .failure(error)
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch read {
        case nil:
            ProgressView()
        case .failure(let error):
            ContentUnavailableView("The file can't be read", systemImage: "doc.questionmark",
                                   description: Text(verbatim: error.msg))
        case .success(let file):
            if let bytes = file.bytes, imageType(route.rel) == nil, let text = decodeText(bytes) {
                CodeText(text: text)
            } else {
                ContentUnavailableView("No preview", systemImage: "doc",
                                       description: Text(Int64(file.size), format: .byteCount(style: .file)))
            }
        }
    }
}
