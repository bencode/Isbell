// The paths a session's chat mentions, made links that open them in Files: found in the agent's words
// and in what was asked, as web/src/features/session/mention-text.tsx; a file opens to be read, a
// folder in the tree. Whether it is there is left to opening it.

import IsbellKit
import SwiftUI
import Textual
import os

/// The paths a chat can open: the roots of its project and the directory its agent works in.
struct ChatPaths {
    let roots: [FilesRoot]
    let cwd: String

    func find(_ text: String) -> [MentionPiece] { mentions(text, roots: roots, cwd: cwd) }

    /// `text` with each path in it a link.
    func linked(_ text: String) -> AttributedString {
        var linked = AttributedString(text)
        link(&linked)
        return linked
    }

    /// Makes links of the paths in `text`, but in code blocks; a link whose address is a path opens it.
    fileprivate func link(_ text: inout AttributedString) {
        let found = text.runs.flatMap { run -> [(Range<AttributedString.Index>, URL)] in
            if let href = run.link { return whole(href.absoluteString).flatMap(pathURL).map { [(run.range, $0)] } ?? [] }
            guard run.presentationIntent?.components.contains(where: { if case .codeBlock = $0.kind { true } else { false } }) != true
            else { return [] }
            var at = run.range.lowerBound
            return find(String(text[run.range].characters)).compactMap { piece in
                let (length, url): (Int, URL?) = switch piece {
                case .text(let plain): (plain.count, nil)
                case .path(let mention): (mention.text.count, pathURL(mention))
                }
                let end = text.characters.index(at, offsetBy: length)
                defer { at = end }
                return url.map { (at..<end, $0) }
            }
        }
        for (range, url) in found {
            text[range].link = url
            text[range].underlineStyle = .single
        }
    }

    /// The path `text` is, where it is wholly one under the roots.
    func whole(_ text: String) -> Mention? {
        let pieces = find(text)
        guard pieces.count == 1, case .path(let mention) = pieces[0], mention.text == text else { return nil }
        return mention
    }
}

extension EnvironmentValues {
    @Entry var chatPaths: ChatPaths? = nil
}

/// Textual's Markdown, with the paths in its words made links.
struct PathsMarkdown: MarkupParser {
    let paths: ChatPaths

    func attributedString(for input: String) throws -> AttributedString {
        var text = try AttributedStringMarkdownParser.markdown().attributedString(for: input)
        paths.link(&text)
        return text
    }
}

private let scheme = "isbell-path"

/// Where a mention leads, as a link that keeps it: `isbell-path:?root=<key>&rel=<rel>[&dir=1]`.
func pathURL(_ mention: Mention) -> URL? {
    var url = URLComponents()
    url.scheme = scheme
    url.queryItems = [URLQueryItem(name: "root", value: mention.root), URLQueryItem(name: "rel", value: mention.rel)]
        + (mention.dir ? [URLQueryItem(name: "dir", value: "1")] : [])
    return url.url
}

extension View {
    /// Finds the paths in the chat under it, and opens one tapped.
    func chatPaths(_ project: Project?, cwd: String?) -> some View {
        modifier(ChatPathsHost(project: project?.path.isEmpty == false ? project : nil, cwd: cwd))
    }
}

private struct ChatPathsHost: ViewModifier {
    @Environment(SpaceStore.self) private var store
    let project: Project?
    let cwd: String?
    /// Its own directory alone until the machine says which worktrees there are.
    @State private var roots: [FilesRoot]?
    @State private var opened: Opened?

    private enum Opened: Hashable {
        case file(FileRoute)
        case folder(FilesRoute)
    }

    func body(content: Content) -> some View {
        let roots = project.map { roots ?? rootsOf($0, []) } ?? []
        content
            .environment(\.chatPaths, project.map { ChatPaths(roots: roots, cwd: cwd ?? $0.path) })
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == scheme else { return .systemAction }
                opened = openedOf(url, roots)
                return opened == nil ? .discarded : .handled
            })
            .navigationDestination(item: $opened) { opened in
                switch opened {
                case .file(let route): FileView(route: route)
                case .folder(let route): FilesView(route: route)
                }
            }
            .task(id: project?.id) { await readRoots() }
    }

    private func openedOf(_ url: URL, _ roots: [FilesRoot]) -> Opened? {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value }
        guard let project, let key = value("root"), let rel = value("rel"),
              let root = roots.first(where: { $0.key == key }) else { return nil }
        let path = joinPath(root.path, rel)
        return value("dir") == nil ? .file(FileRoute(mid: project.mid, path: path, rel: rel))
            : .folder(FilesRoute(projectId: project.id, at: path))
    }

    /// The worktrees as the machine has them; a failure keeps the project's own directory.
    private func readRoots() async {
        guard let project, project.online else { return }
        do throws(CallError) {
            roots = rootsOf(project, try await worktrees(store.call, mid: project.mid, path: project.path))
        } catch {
            logger.warning("could not list the worktrees of \(project.path): \(error.msg)")
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "chat-paths")
