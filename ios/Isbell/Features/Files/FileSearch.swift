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
    /// The path of the file opened last, marked.
    let seen: String?
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
            Text("\(found.paths.count) files")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 2, trailing: 16))
                .listRowSeparator(.hidden)
            VStack(spacing: 0) {
                ForEach(Array(found.paths.enumerated()), id: \.element) { i, rel in
                    if i > 0 { Divider().overlay(Palette.line) }
                    row(rel)
                }
            }
            .background(Palette.raised, in: .rect(cornerRadius: 12))
            .clipShape(.rect(cornerRadius: 12))
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowSeparator(.hidden)
            if found.truncated {
                Text("Showing the first \(found.paths.count) matches")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 8, trailing: 16))
                    .listRowSeparator(.hidden)
            }
        }
    }

    /// A file found: its kind, its name over where it is.
    private func row(_ rel: String) -> some View {
        let path = joinPath(root.path, rel)
        return Button {
            openFile(FileRoute(mid: mid, path: path, rel: rel, branch: root.branch))
        } label: {
            HStack(spacing: 10) {
                Image(systemName: fileIcon(rel)).foregroundStyle(.secondary).frame(width: 22)
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
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(path == seen ? Palette.accentSoft : .clear)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
