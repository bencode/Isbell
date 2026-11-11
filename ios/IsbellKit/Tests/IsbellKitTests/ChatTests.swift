import Foundation
import Testing

@testable import IsbellKit

// The samples of web/src/model/chat/{turns,lines}.test.ts, as the record lines they stand for.

private func read(_ kind: String, _ text: String) -> [ChatTurn] {
    turnsOf(kind: kind, lines: splitLines(Data((text + "\n").utf8), atStart: true).lines)
}

/// 2026-11-07 10:00:00 UTC plus `s` seconds, in milliseconds.
private func at(_ s: Int64) -> Int64 { 1794045600000 + s * 1000 }

@Test func claudesTurnsTellWordsThinkingRepliesAndToolsWithTheirResults() throws {
    let turns = read("claude", claudeLines)
    #expect(turns.count == 3)
    let (cut, first, second) = (turns[0], turns[1], turns[2])
    #expect(cut.id == "start" && cut.you == nil)
    #expect(cut.items == [.text("the end of a turn not read")])
    #expect(first.id == "u1")
    #expect(first.you?.text == "why does the outline not jump?")
    #expect(first.model == "claude-opus-5-5")
    #expect(first.took == 11_000)
    #expect(first.items == [
        .thinking("slugs differ", ms: 6000),
        .text("Found **it**."),
        .tool(ToolItem(id: "t1", name: "Edit", target: "/w/a.ts", error: false, edit: EditCount(add: 1, del: 2), done: false)),
        .tool(ToolItem(id: "t2", name: "Bash", target: "pnpm test", output: "FAIL", error: true, done: true)),
        .note(.interrupted, text: nil),
    ])
    #expect(second.you?.text == "/model opus")
    #expect(second.at == at(30))
}

@Test func codexsCompletedItemsLeaveOutItsInstructionsAndTellHowTurnsEnded() {
    let turns = read("codex", codexLines)
    #expect(turns.count == 2)
    let (first, second) = (turns[0], turns[1])
    #expect(first.id == "q1")
    #expect(first.you == Asked(text: "tidy it", images: ["/tmp/a.png"]))
    #expect(first.model == "gpt-6.1 high")
    #expect(first.took == 9000)
    #expect(first.items == [
        .text("Reading it."),
        .tool(ToolItem(id: "c1", name: "Read", target: "a.md", output: "# A", error: false, done: true)),
        .tool(ToolItem(id: "c2", name: "Bash", target: "make", output: "no rule", error: true, done: true)),
        .tool(ToolItem(id: "f1/0", name: "Edit", target: "/w/a.md", error: false, edit: EditCount(add: 2, del: 1), done: true)),
    ])
    #expect(second.items == [.note(.interrupted, text: nil)])
    #expect(second.took == 1000)
}

@Test func pisToolsGoByClaudeCodesNamesAndAReplyWithoutToolsEndsTheTurn() {
    let turns = read("pi", piLines)
    #expect(turns.count == 1)
    let turn = turns[0]
    #expect(turn.id == "p1")
    #expect(turn.you?.text == "list it")
    #expect(turn.model == "deepseek-v4.1-flash")
    #expect(turn.items == [
        .thinking("ls will do", ms: nil),
        .tool(ToolItem(id: "k1", name: "Edit", target: "/w/b", output: "not found", error: true,
                       edit: EditCount(add: 2, del: 1), done: true)),
        .note(.failed, text: "503"),
    ])
}

@Test func aSessionsRecordIsFoundUnderItsProjectAndNamesItsTranscript() {
    let roots: Roots = ["/w/app": RootInfo(key: "w-app-1", updated: 1), "/tmp/x": RootInfo(key: "tmp-x-2", updated: 2)]
    #expect(recordKey(roots, path: "/w/app", cwd: "/w/app/web") == "w-app-1")
    #expect(recordKey(roots, path: "/w/other", cwd: "/tmp/x") == "tmp-x-2")
    #expect(recordKey(roots, path: "/w/other", cwd: nil) == nil)
    #expect(sessionFilePath(key: "w-app-1", agent: "claude", id: "abc") == "~/.isbell/sessions/w-app-1/sessions/claude-abc.json")
    #expect(transcriptOf(#"{"agent":"claude","transcript":"/h/.claude/p/abc.jsonl"}"#) == "/h/.claude/p/abc.jsonl")
    #expect(transcriptOf(#"{"agent":"claude","transcript":"p/abc.jsonl"}"#) == nil)
    #expect(transcriptOf("{\"agent\":") == nil)
}

private let claudeLines = #"""
{"type": "assistant", "timestamp": "2026-11-07T10:00:00.000Z", "message": {"content": [{"type": "text", "text": "the end of a turn not read"}]}}
{"type": "user", "uuid": "u0", "parentUuid": "a0", "timestamp": "2026-11-07T10:00:01.000Z", "message": {"content": "asked, then gone back on"}}
{"type": "assistant", "uuid": "a1", "parentUuid": "u0", "timestamp": "2026-11-07T10:00:01.000Z", "message": {"content": [{"type": "text", "text": "dropped"}]}}
{"type": "user", "uuid": "u1", "parentUuid": "a0", "timestamp": "2026-11-07T10:00:01.000Z", "message": {"content": "why does the outline not jump?"}}
{"type": "user", "isMeta": true, "timestamp": "2026-11-07T10:00:01.000Z", "message": {"content": "Caveat: …"}}
{"type": "assistant", "timestamp": "2026-11-07T10:00:07.000Z", "message": {"model": "claude-opus-5-5", "content": [{"type": "thinking", "thinking": "slugs differ"}]}}
{"type": "assistant", "timestamp": "2026-11-07T10:00:08.000Z", "message": {"content": [{"type": "text", "text": "Found **it**."}]}}
{"type": "assistant", "timestamp": "2026-11-07T10:00:09.000Z", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Edit", "input": {"file_path": "/w/a.ts", "old_string": "a\nb", "new_string": "c"}}]}}
{"type": "assistant", "isSidechain": true, "timestamp": "2026-11-07T10:00:09.000Z", "message": {"content": [{"type": "text", "text": "a subagent"}]}}
{"type": "assistant", "timestamp": "2026-11-07T10:00:10.000Z", "message": {"content": [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "pnpm test\n--run"}}]}}
{"type": "user", "timestamp": "2026-11-07T10:00:11.000Z", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2", "content": "FAIL", "is_error": true}]}}
{"type": "user", "timestamp": "2026-11-07T10:00:12.000Z", "message": {"content": [{"type": "text", "text": "<task-notification>done</task-notification>"}]}}
{"type": "system", "subtype": "turn_duration", "durationMs": 11000}
{"type": "user", "uuid": "u2", "timestamp": "2026-11-07T10:00:20.000Z", "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}}
{"type": "user", "uuid": "u3", "timestamp": "2026-11-07T10:00:30.000Z", "message": {"content": "<command-name>/model</command-name>\n<command-args>opus</command-args>"}}
"""#

private let codexLines = #"""
{"type": "turn_context", "payload": {"model": "gpt-6.1", "effort": "high"}}
{"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md instructions"}]}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "UserMessage", "id": "q1", "content": [{"type": "text", "text": "tidy it"}, {"type": "local_image", "path": "/tmp/a.png"}]}, "completed_at_ms": 1}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "Reasoning", "id": "r"}, "completed_at_ms": 2}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "AgentMessage", "id": "m1", "content": [{"type": "Text", "text": "Reading it."}], "phase": "commentary"}, "completed_at_ms": 3}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "CommandExecution", "id": "c1", "command": ["/bin/zsh", "-lc", "cat a.md"], "parsed_cmd": [{"type": "read", "cmd": "cat a.md", "path": "a.md"}], "aggregated_output": "# A", "exit_code": 0}, "completed_at_ms": 4}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "CommandExecution", "id": "c2", "command": ["/bin/zsh", "-lc", "make"], "parsed_cmd": [{"type": "unknown", "cmd": "make"}], "aggregated_output": "no rule", "exit_code": 2}, "completed_at_ms": 5}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "FileChange", "id": "f1", "changes": {"/w/a.md": {"type": "update", "unified_diff": "@@ -1 +1,2 @@\n-a\n+b\n+c"}}}, "completed_at_ms": 6}}
{"type": "event_msg", "payload": {"type": "task_complete", "duration_ms": 9000}}
{"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "UserMessage", "id": "q2", "content": [{"type": "text", "text": "stop"}]}, "completed_at_ms": 10}}
{"type": "event_msg", "timestamp": "2026-11-07T10:00:11.000Z", "payload": {"type": "turn_aborted", "reason": "interrupted", "duration_ms": 1000}}
"""#

private let piLines = #"""
{"type": "session", "id": "s"}
{"type": "message", "id": "p1", "message": {"role": "user", "content": [{"type": "text", "text": "list it"}], "timestamp": 1}}
{"type": "message", "id": "", "message": {"role": "assistant", "model": "deepseek-v4.1-flash", "stopReason": "toolUse", "timestamp": 2, "content": [{"type": "thinking", "thinking": "ls will do"}, {"type": "toolCall", "id": "k1", "name": "edit", "arguments": {"path": "/w/b", "edits": [{"oldText": "x", "newText": "y\nz"}]}}]}}
{"type": "message", "id": "", "message": {"role": "toolResult", "toolCallId": "k1", "content": [{"type": "text", "text": "not found"}], "isError": true, "timestamp": 3}}
{"type": "message", "id": "", "message": {"role": "assistant", "stopReason": "error", "errorMessage": "503", "timestamp": 4, "content": []}}
"""#
