import Testing

@testable import IsbellKit

private let project = FilesRoot(key: "app-1", path: "/Users/me/work/app", display: "~/work/app", branch: "main",
                                own: true)

private func worktree(_ path: String, _ branch: String) -> FilesRoot {
    FilesRoot(key: "app-1@\(branch)", path: path, display: path.replacingOccurrences(of: "/Users/me", with: "~"),
              branch: branch, own: false)
}

private func found(_ text: String, cwd: String = project.path, roots: [FilesRoot] = [project]) -> [String] {
    mentions(text, roots: roots, cwd: cwd).compactMap {
        guard case .path(let m) = $0 else { return nil }
        return m.rel + (m.dir ? "/" : "")
    }
}

@Test func findsPathsWithADirectoryAndAnExtensionAsWrittenAroundThem() {
    #expect(found("Changed `web/src/model/projects.ts`, see docs/setup.md.") == ["web/src/model/projects.ts", "docs/setup.md"])
    #expect(found("改好了：web/src/a.ts 里的") == ["web/src/a.ts"])
}

@Test func keepsTheTextWholeAndLeavesTheLineOutOfThePath() {
    #expect(mentions("at src/a.ts:12:3.", roots: [project], cwd: project.path) == [
        .text("at "), .path(Mention(text: "src/a.ts:12:3", root: "app-1", rel: "src/a.ts", dir: false)), .text("."),
    ])
}

@Test func readsRelativePathsFromTheAgentDirectoryAndNoneAboveTheRootOrFromOutsideIt() {
    let cwd = "\(project.path)/web"
    #expect(found("./src/a.ts and ../README.md", cwd: cwd) == ["web/src/a.ts", "README.md"])
    #expect(found("../../other/x.ts", cwd: cwd) == [])
    #expect(found("src/a.ts", cwd: "/Users/me/work/other") == [])
}

@Test func takesAbsolutePathsInsideTheProjectOnly() {
    #expect(found("/Users/me/work/app/src/a.ts and ~/work/app/b.md") == ["src/a.ts", "b.md"])
    #expect(found("/Users/me/work/other/a.ts and /etc/hosts") == [])
}

@Test func leadsIntoTheOtherWorktreesTooTheDeepestWhereTheyNest() {
    let roots = [project, worktree("/Users/me/work/app.wt/feat", "feat"), worktree("\(project.path)/.wt/fix", "fix")]
    let at = mentions("/Users/me/work/app.wt/feat/a.ts ~/work/app/.wt/fix/b.md /Users/me/work/app/c.ts",
                      roots: roots, cwd: project.path).compactMap { piece -> String? in
        guard case .path(let m) = piece else { return nil }
        return "\(m.root):\(m.rel)"
    }
    #expect(at == ["app-1@feat:a.ts", "app-1@fix:b.md", "app-1:c.ts"])
}

@Test func takesABareNameOnlyWithAPlainFileExtension() {
    #expect(found("Ran calc.py and edited package.json") == ["calc.py", "package.json"])
    #expect(found("isbell.fmap.dev runs 0.2.0 on Node.js, e.g. now") == [])
}

@Test func leavesOutAddressesAndWordsJoinedByASlash() {
    #expect(found("see https://isbell.fmap.dev/a.html; read/write and/or") == [])
}

@Test func marksAPathEndingInASlashAsADirectory() {
    #expect(found("look in web/src/") == ["web/src/"])
}
