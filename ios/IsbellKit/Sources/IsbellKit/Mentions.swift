// The paths an agent mentions in what it says, found in the text so they can be opened. A word is a
// path only when it reads unmistakably as one, and only one leading into the project, or another of
// its worktrees, counts; whether the file is there is left to opening it. As
// web/src/model/files/mentions.ts.

import Foundation

/// `root`: the key of the root the path leads into; `rel`, where it leads in it.
public struct Mention: Sendable, Equatable {
    public var text: String
    public var root: String
    public var rel: String
    public var dir: Bool
}

public enum MentionPiece: Sendable, Equatable {
    case text(String)
    case path(Mention)
}

// What words are cut at, the separators kept: spaces, quotes, brackets and the punctuation around a
// path in English or Chinese.
private nonisolated(unsafe) let separator = #/[\s"'`()\[\]{}<>,;，。；：、（）「」《》“”‘’]+/#
private nonisolated(unsafe) let trailing = #/[.:!?]+$/#
private nonisolated(unsafe) let line = #/(?::\d+){1,2}$/#.asciiOnlyDigits()
private nonisolated(unsafe) let fileExtension = #/\.[A-Za-z][A-Za-z\d]{0,7}$/#.asciiOnlyDigits()
// A word without a '/' is a file only with an extension that is plainly one.
private nonisolated(unsafe) let known =
    #/^[\w.-]*\w\.(?:tsx?|jsx?|mjs|cjs|json|mdx?|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|rb|php|sh|zsh|toml|ya?ml|lock|css|scss|html|sql|txt|csv|vue|svelte|png|jpe?g|gif|webp|avif|svg)$/#
        .asciiOnlyWordCharacters()
// Library names such as Node.js read as files otherwise.
private nonisolated(unsafe) let library = #/^[A-Z][a-z]+\.js$/#
private nonisolated(unsafe) let leading = #/^(?:\.{1,2}|~)?\//#

/// `text` cut into plain runs and the paths in it that lead into one of `roots`, as read from `cwd`.
public func mentions(_ text: String, roots: [FilesRoot], cwd: String) -> [MentionPiece] {
    var pieces: [MentionPiece] = []
    func add(_ piece: MentionPiece) {
        if case .text(let more) = piece {
            if more.isEmpty { return }
            if case .text(let last) = pieces.last { return pieces[pieces.count - 1] = .text(last + more) }
        }
        pieces.append(piece)
    }
    func word(_ word: Substring) {
        let tail = word.firstMatch(of: trailing).map { String($0.output) } ?? ""
        let body = String(word.dropLast(tail.count))
        if let at = mentionOf(body, roots: roots, cwd: cwd) {
            add(.path(at))
            add(.text(tail))
        } else {
            add(.text(String(word)))
        }
    }
    var from = text.startIndex
    for cut in text.matches(of: separator) {
        word(text[from..<cut.range.lowerBound])
        add(.text(String(text[cut.range])))
        from = cut.range.upperBound
    }
    word(text[from...])
    return pieces
}

private func mentionOf(_ text: String, roots: [FilesRoot], cwd: String) -> Mention? {
    let path = text.replacing(line, with: "")
    guard looksLikePath(path) else { return nil }
    let dir = path.hasSuffix("/")
    let bare = String(path.reversed().drop { $0 == "/" }.reversed())
    guard let at = resolve(bare, roots: roots, cwd: cwd), !at.rel.isEmpty else { return nil }
    return Mention(text: text, root: at.root.key, rel: at.rel, dir: dir)
}

private func looksLikePath(_ path: String) -> Bool {
    if path.isEmpty || path.contains("://") { return false }
    guard let slash = path.lastIndex(of: "/") else {
        return path.wholeMatch(of: known) != nil && path.wholeMatch(of: library) == nil
    }
    let name = path[path.index(after: slash)...]
    return name.firstMatch(of: fileExtension) != nil || path.hasSuffix("/") || path.firstMatch(of: leading) != nil
}

/// The root `path` leads into and where in it, or nil when it leads outside them all.
private func resolve(_ path: String, roots: [FilesRoot], cwd: String) -> (root: FilesRoot, rel: String)? {
    if path.hasPrefix("/") { return rootHolding(roots, path) }
    if path.hasPrefix("~/") { return rootHolding(roots, path, at: \.display) }
    // From outside the roots, a relative path cannot be told to lead into one; nor above its own.
    guard let from = rootHolding(roots, cwd) else { return nil }
    guard case .file(let rel) = resolveLink(from.rel.isEmpty ? "_" : "\(from.rel)/_", path) else { return nil }
    return (from.root, rel)
}
