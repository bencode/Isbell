// The files found by path, each name over where it is, what was searched for in bold. As
// web/src/shell/mobile/files/search.tsx.

import IsbellKit
import SwiftUI

struct FoundFiles: View {
    /// nil while searching.
    let found: Result<Found, CallError>?
    let mid: String
    let root: FilesRoot
    let query: String
    let openFile: (FileRoute) -> Void

    var body: some View {
        switch found {
        case nil:
            ProgressView("Searching…").frame(maxWidth: .infinity)
        case .failure(let error):
            Text(verbatim: error.msg).font(.footnote).foregroundStyle(.red)
        case .success(let found) where found.paths.isEmpty:
            Text("No files match").font(.footnote).foregroundStyle(.secondary)
        case .success(let found):
            ForEach(found.paths, id: \.self) { rel in
                Button {
                    openFile(FileRoute(mid: mid, path: joinPath(root.path, rel), rel: rel, branch: root.branch))
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(marked(nameOf(rel), query)).lineLimit(1)
                        if !dirOf(rel).isEmpty {
                            Text(marked(dirOf(rel), query))
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            if found.truncated {
                Text("Showing the first \(found.paths.count) matches").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
