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

/// The entries of the folder at `rel`; an open folder lists its own under it.
struct FileLevel: View {
    @Environment(SpaceStore.self) private var store
    let tree: FileTree
    let mid: String
    let root: FilesRoot
    let rel: String
    let openFile: (FileRoute) -> Void

    var body: some View {
        switch tree.listing(root, rel) {
        case .success(let listing):
            if listing.entries.isEmpty { note(Text("Empty folder")) }
            ForEach(listing.entries, id: \.name) { row($0) }
            if listing.total > listing.entries.count {
                note(Text("\(listing.total - listing.entries.count) more not listed"))
            }
        case .failure(let error):
            note(Text(verbatim: error.msg)).foregroundStyle(.red)
        case nil:
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .leading)
                .task { await tree.read(store.call, mid: mid, root: root, rel: rel) }
        }
    }

    @ViewBuilder private func row(_ entry: DirEntry) -> some View {
        let child = rel.isEmpty ? entry.name : "\(rel)/\(entry.name)"
        if entry.kind == .dir {
            DisclosureGroup(isExpanded: open(child)) {
                FileLevel(tree: tree, mid: mid, root: root, rel: child, openFile: openFile)
            } label: {
                name(entry.name, icon: "folder")
            }
        } else {
            Button {
                openFile(FileRoute(mid: mid, path: joinPath(root.path, child), rel: child))
            } label: {
                name(entry.name, icon: "doc")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }

    private func open(_ child: String) -> Binding<Bool> {
        Binding(get: { store.prefs.openDirs[root.key]?.contains(child) ?? false },
                set: { store.prefs.setOpen(root.key, child, $0) })
    }

    private func name(_ name: String, icon: String) -> some View {
        Label(name, systemImage: icon)
            .lineLimit(1)
            .foregroundStyle(name.hasPrefix(".") ? .secondary : .primary)
    }

    private func note(_ text: Text) -> some View {
        text.font(.footnote).foregroundStyle(.secondary)
    }
}
