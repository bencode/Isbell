// The tree of a root's files, its folders opening in place, each listed as it opens and kept while
// the page is; the folders left open are kept per root. As web/src/shell/mobile/files/tree.tsx.

import IsbellKit
import Observation
import SwiftUI

/// What the folders list, by root and their path from it ("" for the root): a root gone back to shows
/// what it had.
@MainActor
@Observable
final class FileTree {
    private var listed: [String: [String: Result<Listing, CallError>]] = [:]
    @ObservationIgnored private var reading: Set<String> = []

    func listing(_ root: FilesRoot, _ rel: String) -> Result<Listing, CallError>? { listed[root.key]?[rel] }

    func read(_ call: Caller, mid: String, root: FilesRoot, rel: String) async {
        let id = "\(root.key)\n\(rel)"
        guard reading.insert(id).inserted else { return }
        defer { reading.remove(id) }
        do throws(CallError) {
            listed[root.key, default: [:]][rel] = .success(try await listDir(call, mid: mid, path: joinPath(root.path, rel)))
        } catch {
            listed[root.key, default: [:]][rel] = .failure(error)
        }
    }

    /// Lists again each folder of `root` listed, showing what they had meanwhile.
    func refresh(_ call: Caller, mid: String, root: FilesRoot) async {
        for rel in listed[root.key].map({ Array($0.keys) }) ?? [] { await read(call, mid: mid, root: root, rel: rel) }
    }
}

/// The entries of the folder at `rel`, `depth` folders down from the root; an open folder lists its
/// own under it, a line down from it for each level.
struct FileLevel: View {
    @Environment(SpaceStore.self) private var store
    let tree: FileTree
    let mid: String
    let root: FilesRoot
    let rel: String
    var depth = 0
    let openFile: (FileRoute) -> Void

    var body: some View {
        // Rows meet, so each folder's line runs down unbroken.
        Group { rows }
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
    }

    @ViewBuilder private var rows: some View {
        switch tree.listing(root, rel) {
        case .success(let listing):
            if listing.entries.isEmpty { note(Text("Empty folder")) }
            ForEach(listing.entries, id: \.name) { row($0) }
            if listing.total > listing.entries.count {
                note(Text("\(listing.total - listing.entries.count) more not listed"))
            }
        case .failure(let error):
            note(Text(verbatim: error.msg).foregroundStyle(.red))
        case nil:
            indented(ProgressView())
                .task { await tree.read(store.call, mid: mid, root: root, rel: rel) }
        }
    }

    @ViewBuilder private func row(_ entry: DirEntry) -> some View {
        let child = rel.isEmpty ? entry.name : "\(rel)/\(entry.name)"
        if entry.kind == .dir {
            let open = store.prefs.openDirs[root.key]?.contains(child) ?? false
            Button {
                withAnimation { store.prefs.setOpen(root.key, child, !open) }
            } label: {
                name(entry.name, icon: "folder", open: open)
            }
            .buttonStyle(.plain)
            .accessibilityValue(Text(open ? "expanded" : "collapsed"))
            if open {
                FileLevel(tree: tree, mid: mid, root: root, rel: child, depth: depth + 1, openFile: openFile)
            }
        } else {
            Button {
                openFile(FileRoute(mid: mid, path: joinPath(root.path, child), rel: child, branch: root.branch))
            } label: {
                name(entry.name, icon: fileIcon(entry.name), open: nil)
            }
            .buttonStyle(.plain)
        }
    }

    /// `open` is nil for a file, which has no arrow but keeps its room.
    private func name(_ name: String, icon: String, open: Bool?) -> some View {
        indented(HStack(spacing: 8) {
            Image(systemName: open == true ? "chevron.down" : "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
                .frame(width: 14)
                .opacity(open == nil ? 0 : 1)
            Image(systemName: icon).foregroundStyle(.secondary).frame(width: 22)
            Text(verbatim: name)
                .lineLimit(1)
                .foregroundStyle(name.hasPrefix(".") ? .secondary : .primary)
        })
    }

    private func note(_ text: some View) -> some View {
        indented(text.font(.footnote).foregroundStyle(.secondary).padding(.leading, 22))
    }

    /// A row of the tree: in by its depth, with the line of each folder it is in.
    private func indented(_ content: some View) -> some View {
        content
            .padding(.leading, 14 + CGFloat(depth) * 22)
            .padding(.trailing, 16)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .overlay(alignment: .leading) {
                ForEach(0..<depth, id: \.self) { level in
                    Rectangle().fill(Palette.line).frame(width: 1).offset(x: CGFloat(level + 1) * 22)
                }
            }
            .contentShape(.rect)
    }
}

/// What a file is, as its icon: an image, text, code, or else a plain document.
private func fileIcon(_ name: String) -> String {
    if imageType(name) != nil { return "photo" }
    if ["md", "markdown", "txt"].contains((name as NSString).pathExtension.lowercased()) { return "doc.text" }
    if codeLanguage(name) != nil { return "chevron.left.forwardslash.chevron.right" }
    return "doc"
}
