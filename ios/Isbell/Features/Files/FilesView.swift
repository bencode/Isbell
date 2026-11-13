// A project's files: the tree of its directory, or of another worktree of its repository picked from
// the title, and the files found by path as a search is typed. As web/src/shell/mobile/files/*.

import IsbellKit
import SwiftUI
import os

struct FilesRoute: Hashable {
    /// A `Project.id`.
    let projectId: String
    /// Opened to this directory: in the root holding it, its folders open down to it.
    var at: String? = nil
}

struct FilesView: View {
    @Environment(SpaceStore.self) private var store
    let route: FilesRoute
    /// Its own directory alone until the machine says which worktrees there are.
    @State private var roots: [FilesRoot]?
    @State private var rootKey: String?
    @State private var tree = FileTree()
    /// As typed, and searched for once typing pauses.
    @State private var text = ""
    @State private var query = ""
    @State private var found: Result<Found, CallError>?
    @State private var finding = false
    @State private var placed = false
    /// Listing the worktrees: as many asking at once, as each item of the menu does, ask once.
    @State private var listing = false

    private struct Search: Hashable {
        let root: String
        let query: String
    }

    var body: some View {
        let project = store.projects.first { $0.id == route.projectId }
        let all = roots ?? project.map { rootsOf($0, []) } ?? []
        let root = rootKey.map { key in all.first { $0.key == key } } ?? all.first
        content(project, root)
            .navigationTitle(project?.name ?? "")
            .navigationSubtitle(Text(verbatim: root?.branch ?? ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarTitleMenu { worktreeMenu(all, current: root, project: project) }
            .searchable(text: $text, prompt: Text("Find a file"))
            .task(id: text) {
                if await pause(.milliseconds(300)) { query = text.trimmingCharacters(in: .whitespaces) }
            }
            .task { if let project { await readRoots(project) } }
            .sheet(isPresented: $finding) {
                WorktreeSheet(roots: all, current: root?.key) { rootKey = $0.key }
            }
            .navigationDestination(for: FileRoute.self) { FileView(route: $0) }
    }

    @ViewBuilder private func content(_ project: Project?, _ root: FilesRoot?) -> some View {
        if let why = unavailable(project, root) {
            ContentUnavailableView { why }
        } else if let project, let root {
            List {
                if query.isEmpty {
                    FileLevel(tree: tree, mid: project.mid, root: root, rel: "")
                } else {
                    FoundFiles(found: found, mid: project.mid, root: root, query: query)
                }
            }
            .listStyle(.plain)
            .refreshable {
                await readRoots(project)
                await tree.refresh(store.call, mid: project.mid, root: root)
            }
            .task(id: Search(root: root.path, query: query)) { await search(project.mid, root) }
        } else {
            ProgressView()
        }
    }

    /// Why the files cannot be read, if they cannot; as web/src/features/files/notes.ts.
    private func unavailable(_ project: Project?, _ root: FilesRoot?) -> Label<Text, Image>? {
        guard let project else {
            return store.space.loaded ? Label("This project is gone", systemImage: "folder.badge.questionmark") : nil
        }
        if !project.online { return Label("The machine is offline", systemImage: "desktopcomputer") }
        let caps = store.space.machines.first { $0.id == project.mid }?.state.caps
        if caps.map({ !$0.methods.contains("isbell.file.list") }) == true {
            return Label("isbell on \(project.machine) is too old to browse files. Update it there.", systemImage: "arrow.up.circle")
        }
        if project.path.isEmpty { return Label("This project has no directory", systemImage: "folder") }
        if root == nil { return Label("This worktree is gone", systemImage: "arrow.triangle.branch") }
        return nil
    }

    @ViewBuilder private func worktreeMenu(_ all: [FilesRoot], current: FilesRoot?, project: Project?) -> some View {
        Group {
            if all.count > 8 {
                Button("Find a worktree…", systemImage: "magnifyingglass") { finding = true }
            } else {
                ForEach(all) { r in
                    Button {
                        rootKey = r.key
                    } label: {
                        Label {
                            Text(verbatim: r.branch ?? String(localized: "detached"))
                            Text(verbatim: r.display)
                        } icon: {
                            Image(systemName: r.key == current?.key ? "checkmark" : "arrow.triangle.branch")
                        }
                    }
                }
            }
        }
        // Read again as it opens, so a worktree made meanwhile is there.
        .onAppear { if let project { Task { await readRoots(project) } } }
    }

    /// The worktrees as the machine has them; a failure keeps those read before. The first time, the
    /// root it was opened to.
    private func readRoots(_ project: Project) async {
        guard project.online, !project.path.isEmpty, !listing else { return }
        listing = true
        defer { listing = false }
        do throws(CallError) {
            roots = rootsOf(project, try await worktrees(store.call, mid: project.mid, path: project.path))
        } catch {
            logger.warning("could not list the worktrees of \(project.path): \(error.msg)")
        }
        guard !placed else { return }
        placed = true
        if let at = route.at, let held = rootHolding(roots ?? rootsOf(project, []), at) {
            rootKey = held.root.key
            if !held.rel.isEmpty { store.prefs.openDown(held.root.key, to: held.rel) }
        }
    }

    private func search(_ mid: String, _ root: FilesRoot) async {
        found = nil
        guard !query.isEmpty else { return }
        let result: Result<Found, CallError>
        do throws(CallError) {
            result = .success(try await searchFiles(store.call, mid: mid, root: root.path, query: String(query.prefix(200))))
        } catch {
            result = .failure(error)
        }
        // A search typed over since: what it found would show over what the newer one finds.
        if !Task.isCancelled { found = result }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "files")
