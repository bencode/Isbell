import Foundation
import Testing

@testable import IsbellKit

// Samples from web/src/model/{agent-note,herdr,project-config,sessions,files/repo}.test.ts.

@Test func theHookReportsTheQuestionTheToolAndTheOneAsked() {
    let note = noteOf(AgentInfo(agent: "claude", tokens: [
        "isbell_ask": "review PR #90", "isbell_tool": "Bash", "isbell_target": "Run web unit tests",
        "isbell_wait_tool": "Write", "isbell_wait_target": "notes.txt", "isbell_mode": "plan",
    ]))
    #expect(note == AgentNote(asked: "review PR #90", doing: ToolUse(tool: "Bash", target: "Run web unit tests"),
                              asking: ToolUse(tool: "Write", target: "notes.txt"), mode: "plan"))
    #expect(toolLine(note.doing!) == "Bash Run web unit tests")
}

@Test func clearedReportsAndTheDefaultModeSayNothing() {
    let tokens: [String: String?] = ["isbell_ask": "", "isbell_tool": .none, "isbell_target": "x", "isbell_mode": "default"]
    let cleared = AgentInfo(agent: "claude", tokens: tokens)
    #expect(noteOf(cleared) == AgentNote())
    #expect(noteOf(AgentInfo(agent: "claude", tokens: ["isbell_tool": "ToolSearch"])).doing == ToolUse(tool: "ToolSearch"))
}

@Test func reportsAreReadOnlyForTheAgentThatLeftThem() {
    #expect(noteOf(AgentInfo(agent: "codex", tokens: ["isbell_ask": "old question"])) == AgentNote())
    let tokens: [String: String?] = ["isbell_agent": "codex", "isbell_ask": "fix the build", "isbell_session": "thread-1"]
    #expect(noteOf(AgentInfo(agent: "codex", tokens: tokens)) == AgentNote(asked: "fix the build", session: "thread-1"))
    #expect(noteOf(AgentInfo(agent: "claude", tokens: tokens)) == AgentNote())
}

@Test func theTerminalTitleIsTheTaskUnlessItNamesNone() {
    let title = { (agent: String, title: String) in
        titleOf(AgentInfo(agent: agent, cwd: "/Users/me/work/Isbell", terminalTitle: title))
    }
    #expect(title("claude", "Baton PR #90") == "Baton PR #90")
    #expect(title("codex", "切换到新方案 | Isbell") == "切换到新方案")
    #expect(title("claude", "Claude Code") == nil)
    #expect(title("codex", "codex") == nil)
    #expect(title("codex", "codex --no-daemon | Isbell") == nil)
    #expect(title("codex", "codex fixes the build | Isbell") == "codex fixes the build")
    #expect(title("codex", "Isbell") == nil)
    #expect(title("pi", "π - Isbell") == nil)
    #expect(title("claude", " ") == nil)
}

@Test func herdrsSessionStandsInForTheAgentInThePane() {
    let id = "66a3ee45-fe22-43be-874b-0bc10ff867e2"
    let found = { (agent: String, kind: String, value: String) in AgentInfo.Found(agent: agent, kind: kind, value: value) }
    #expect(noteOf(AgentInfo(agent: "claude", agentSession: found("claude", "id", id))) == AgentNote(session: id))
    let file = "/h/.pi/agent/sessions/--w--/2026-11-01T03-29-35-314Z_\(id).jsonl"
    #expect(noteOf(AgentInfo(agent: "pi", agentSession: found("pi", "path", file))) == AgentNote(session: id, file: file))
    #expect(noteOf(AgentInfo(agent: "codex", agentSession: found("pi", "path", file))) == AgentNote())
}

@Test func aSnapshotGivesShellsAndTheTasksAgentsAreTitledWith() throws {
    let text = """
    {"snapshot":{"panes":[
      {"pane_id":"p1","agent":"codex","cwd":"/w/app","terminal_title_stripped":"Greet user | app"},
      {"pane_id":"p2","agent":"claude","cwd":"/w/app","terminal_title_stripped":"Claude Code"},
      {"pane_id":"p3","agent":"pi","cwd":"/w/app","terminal_title_stripped":"π - app"},
      {"pane_id":"p4","cwd":"/w/app","foreground_cwd":"/w/app/src","terminal_title_stripped":"a shell"},
      {"cwd":"/w"}
    ]}}
    """
    let found = readPanes(try JSONDecoder().decode(JSON.self, from: Data(text.utf8)), mid: "m")
    #expect(found.titles == ["p1": "Greet user"])
    #expect(found.shells == [Shell(mid: "m", paneId: "p4", cwd: "/w/app/src", title: "a shell")])
}

@Test func aProjectListIsReadOnlyWhenEveryEntryIsAnAbsolutePath() {
    #expect(parseProjects(#"{"version":1,"projects":[{"path":"/w/b"},{"path":"/w/a/"}]}"#) == ["/w/b", "/w/a"])
    let refused = ["{", "null", #"{"version":2,"projects":[]}"#, #"{"version":1,"projects":[{"dir":"/w"}]}"#,
                   #"{"version":1,"projects":[{"path":"~/w"}]}"#, #"{"version":1,"projects":[{"path":""}]}"#]
    #expect(refused.allSatisfy { parseProjects($0) == nil })
}

@Test func whatAMachineSaysWinsOverWhatWasKept() {
    let kept = ["a": ["/kept"], "b": ["/kept"], "c": ["/kept"], "d": ["/kept"]]
    let listed = listedPaths(["a": .listed(["/read"]), "b": .missing, "c": .broken], kept: kept)
    #expect(listed == ["a": ["/read"], "d": ["/kept"]])
}

@Test func recordsHalfWrittenOrOfAnotherShapeArePassedOver() {
    #expect(parseRoots(#"{"/srv/a": {"key": "srv-a-1", "updated": 2}, "rel": {"key": "x", "updated": 1},"#) == [:])
    let text = #"{"/srv/a": {"key": "srv-a-1", "updated": 2}, "rel": {"key": "x", "updated": 1}, "/b": {"key": ""}}"#
    #expect(parseRoots(text) == ["/srv/a": RootInfo(key: "srv-a-1", updated: 2)])
}

@Test func aRepositoryIsLookedForBelowTheHomeOnly() {
    #expect(repoCandidates("/Users/me/work/Isbell/web/") == ["/Users/me/work/Isbell/web", "/Users/me/work/Isbell", "/Users/me/work"])
    #expect(repoCandidates("/srv/a") == ["/srv/a", "/srv"])
    #expect(repoCandidates("/Users/me").isEmpty)
}
