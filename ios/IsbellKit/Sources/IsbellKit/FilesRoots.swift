// The directories a project's files are browsed in: its own, and the other worktrees of its
// repository that have a branch checked out, each with a key of its own; and the paths within them.
// As web/src/model/files/{worktrees,paths}.ts.

import Foundation

/// A directory whose files are browsed. `key` names it where its folders left open are kept: the
/// project's id for its own directory, `<id>@<branch>` for another worktree.
public struct FilesRoot: Sendable, Hashable, Identifiable {
    public var key: String
    public var path: String
    public var display: String
    public var branch: String?
    public var own: Bool

    public var id: String { key }
}

/// The project's own directory first, then the other worktrees with a branch, by branch.
public func rootsOf(_ project: Project, _ worktrees: [Worktree]) -> [FilesRoot] {
    let own = FilesRoot(key: project.id, path: project.path, display: project.display,
                        branch: worktrees.first { $0.here }?.branch, own: true)
    let others = worktrees.compactMap { w -> FilesRoot? in
        guard !w.here, let branch = w.branch else { return nil }
        return FilesRoot(key: "\(project.id)@\(branch)", path: w.path,
                         display: tildify(w.path, home: homeOf([w.path, project.path])), branch: branch, own: false)
    }
    return [own] + others.sorted { $0.branch! < $1.branch! }
}

/// The roots whose branch or directory holds `query`, ignoring case, in their order.
public func matchRoots(_ roots: [FilesRoot], _ query: String) -> [FilesRoot] {
    let needle = query.trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return roots }
    return roots.filter { "\($0.branch ?? "")\n\($0.display)".localizedCaseInsensitiveContains(needle) }
}

/// The root `abs` is under, the deepest where worktrees nest, and where it sits in it.
public func rootHolding(_ roots: [FilesRoot], _ abs: String) -> (root: FilesRoot, rel: String)? {
    roots.compactMap { root in relativePath(root.path, abs).map { (root: root, rel: $0) } }
        .min { $0.rel.count < $1.rel.count }
}

/// `abs` as a path from `base`: "" for `base` itself, nil for one outside it.
public func relativePath(_ base: String, _ abs: String) -> String? {
    let base = trimSlash(base), abs = trimSlash(abs)
    if abs == base { return "" }
    let prefix = base == "/" ? "/" : "\(base)/"
    return abs.hasPrefix(prefix) ? String(abs.dropFirst(prefix.count)) : nil
}

public func joinPath(_ dir: String, _ rel: String) -> String {
    rel.isEmpty ? dir : dir.hasSuffix("/") ? dir + rel : "\(dir)/\(rel)"
}

/// The folders `rel` is inside of, the outermost first: "a/b/c" → ["a", "a/b"].
public func ancestors(_ rel: String) -> [String] {
    let parts = rel.split(separator: "/").map(String.init)
    return parts.indices.dropLast().map { parts[...$0].joined(separator: "/") }
}

public func nameOf(_ rel: String) -> String { rel.split(separator: "/").last.map(String.init) ?? rel }

/// The folder `rel` is in, "" at the top.
public func dirOf(_ rel: String) -> String { ancestors(rel).last ?? "" }

/// Where a link in a file goes.
public enum FileLink: Equatable, Sendable {
    /// A place in the same file.
    case anchor(String)
    /// Out to the web, or to mail.
    case external
    /// A file under the root, from it.
    case file(String)
    /// Nowhere it can be followed: another scheme, an absolute path, or above the root.
    case inert
}

/// Where `href`, in the file at `fileRel`, goes: a file only where it stays under the root.
public func resolveLink(_ fileRel: String, _ href: String) -> FileLink {
    if href.hasPrefix("#") { return .anchor(decoded(String(href.dropFirst()))) }
    if href.firstMatch(of: /^(https?|mailto):/.ignoresCase()) != nil { return .external }
    if href.isEmpty || href.hasPrefix("/") || href.firstMatch(of: /^[a-zA-Z][a-zA-Z0-9+.\-]*:/) != nil { return .inert }
    let target = decoded(String(href.prefix { $0 != "?" && $0 != "#" }))
    var resolved: [Substring] = []
    for part in fileRel.split(separator: "/").dropLast() + target.split(separator: "/") {
        if part == ".." {
            // Above the root.
            guard resolved.popLast() != nil else { return .inert }
        } else if part != "." {
            resolved.append(part)
        }
    }
    return resolved.isEmpty ? .inert : .file(resolved.joined(separator: "/"))
}

/// `s` percent-decoded; a stray '%' is meant as it is.
private func decoded(_ s: String) -> String { s.removingPercentEncoding ?? s }
