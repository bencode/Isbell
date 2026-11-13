import Foundation
import Testing

@testable import IsbellKit

// Samples from web/src/model/files/worktrees.test.ts and paths.test.ts.

private let project = Project(mid: "m1", machine: "mini", online: true, path: "/Users/me/work/app",
                              display: "~/work/app", name: "app", configured: true, sessions: [], shells: [])

@Test func theProjectComesFirstThenOtherBranchesByNameLeavingOutADetachedHead() {
    let roots = rootsOf(project, [
        Worktree(path: "/Users/me/work/app", branch: "main", here: true),
        Worktree(path: "/tmp/loose", branch: nil, here: false),
        Worktree(path: "/Users/me/work/app.wt/zed", branch: "zed", here: false),
        Worktree(path: "/Users/me/work/app.wt/feat", branch: "feat/x", here: false),
    ])
    #expect(roots.map(\.key) == [project.id, "\(project.id)@feat/x", "\(project.id)@zed"])
    #expect(roots.map(\.branch) == ["main", "feat/x", "zed"])
    #expect(roots.map(\.display) == ["~/work/app", "~/work/app.wt/feat", "~/work/app.wt/zed"])
    #expect(rootsOf(project, []).map(\.branch) == [nil])
}

@Test func aWorktreeIsFoundByItsBranchOrDirectoryInItsOrder() {
    let roots = rootsOf(project, [
        Worktree(path: "/Users/me/work/app", branch: "main", here: true),
        Worktree(path: "/Users/me/work/app-wt/preview", branch: "zed", here: false),
        Worktree(path: "/Users/me/work/app-wt/x", branch: "feat/Preview", here: false),
    ])
    #expect(matchRoots(roots, " preview ").map(\.branch) == ["feat/Preview", "zed"])
    #expect(matchRoots(roots, "").count == 3)
    #expect(matchRoots(roots, "nothing").isEmpty)
}

@Test func aPathIsInTheDeepestRootHoldingIt() {
    let roots = rootsOf(project, [
        Worktree(path: "/Users/me/work/app", branch: "main", here: true),
        Worktree(path: "/Users/me/work/app/.wt/feat", branch: "feat", here: false),
    ])
    #expect(rootHolding(roots, "/Users/me/work/app/.wt/feat/src").map { [$0.root.branch, $0.rel] } == ["feat", "src"])
    #expect(rootHolding(roots, "/Users/me/work/app").map(\.rel) == "")
    #expect(rootHolding(roots, "/Users/me/work/apple") == nil)
}

@Test func pathsWithinARoot() {
    #expect(relativePath("/a/b/", "/a/b/c/d") == "c/d")
    #expect(relativePath("/", "/etc") == "etc")
    #expect(relativePath("/a/b", "/a/bc") == nil)
    #expect(ancestors("a/b/c") == ["a", "a/b"])
    #expect(ancestors("a").isEmpty)
    #expect(nameOf("a/b/c.swift") == "c.swift" && dirOf("a/b/c.swift") == "a/b" && dirOf("c") == "")
    #expect(joinPath("/r", "a/b") == "/r/a/b" && joinPath("/r", "") == "/r")
}

@Test func aFileWithANulByteOrNotUTF8IsNoText() {
    #expect(decodeText(Data("héllo".utf8)) == "héllo")
    #expect(decodeText(Data([0x61, 0x00, 0x62])) == nil)
    #expect(decodeText(Data([0xff, 0xfe, 0x41])) == nil)
}

@Test func aFilesLanguageIsByItsExtensionOrWholeName() {
    #expect(codeLanguage("main.swift") == "swift")
    #expect(codeLanguage("App.TSX") == "typescript")
    #expect(codeLanguage("Dockerfile") == "dockerfile")
    #expect(codeLanguage("Cargo.lock") == nil)
    #expect(codeLanguage(".gitignore") == nil)
    #expect(codeLanguage("README") == nil)
}
