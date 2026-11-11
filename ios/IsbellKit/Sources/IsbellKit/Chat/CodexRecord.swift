// Codex's rollout: the items each turn completed (what was asked, what it said, the commands it
// ran, the files it changed), how each turn ended, and the model it ran on.
// As web/src/model/chat/codex.ts.

import Foundation

private func fileOf(_ path: String) -> String {
    path.hasPrefix("file://") ? String(path.dropFirst("file://".count)) : path
}

private func firstLine(_ s: String) -> String {
    s.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
}

/// A command's verb as Codex parses it: a read, a search, a listing, or a command run.
private func commandItem(_ id: String, _ it: JSON) -> ChatItem {
    let parsed = objects(it["parsed_cmd"])
    let one = parsed.count == 1 ? parsed.first : nil
    let command: String = if case .array(let parts)? = it["command"] { text(parts.last) } else { text(it["command"]) }
    let (name, target): (String, String) = switch one?["type"]?.string {
    case "read": ("Read", text(one?["path"]).isEmpty ? text(one?["cmd"]) : text(one?["path"]))
    case "search": ("Search", text(one?["cmd"]))
    case "list_files": ("List", text(one?["cmd"]))
    default: ("Bash", command)
    }
    let output = text(it["aggregated_output"])
    let code = number(it["exit_code"])
    return .tool(ToolItem(id: id, name: name, target: firstLine(target), output: output.isEmpty ? nil : output,
                          error: code.map { $0 != 0 } ?? false, done: true))
}

private func changeItems(_ id: String, _ changes: JSON?) -> [ChatItem] {
    guard case .object(let all)? = changes else { return [] }
    // Codex writes the changes in one object; by path is the order they show in.
    return all.sorted { $0.key < $1.key }.enumerated().map { i, entry in
        let c = entry.value
        let type = c["type"]?.string
        let edit = switch type {
        case "add": EditCount(add: text(c["content"]).split(separator: "\n", omittingEmptySubsequences: false).count, del: 0)
        case "update": diffOf(text(c["unified_diff"]))
        default: EditCount(add: 0, del: 0)
        }
        return .tool(ToolItem(id: "\(id)/\(i)", name: type == "add" ? "Write" : "Edit", target: fileOf(entry.key),
                              error: false, edit: edit, done: true))
    }
}

/// What each kind of completed item shows as; kinds not here (reasoning, which is kept secret, and
/// others) show nothing.
private let items: [String: @Sendable (JSON, String) -> [ChatItem]] = [
    "AgentMessage": { it, _ in
        let said = objects(it["content"]).map { text($0["text"]) }.joined()
        return said.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : [.text(said)]
    },
    "CommandExecution": { it, id in [commandItem(id, it)] },
    "FileChange": { it, id in changeItems(id, it["changes"]) },
    "McpToolCall": { it, id in
        let output = objects(it["result"]?["content"]).map { text($0["text"]) }.joined(separator: "\n")
        return [.tool(ToolItem(id: id, name: text(it["tool"]), target: text(it["server"]),
                               output: output.isEmpty ? nil : output, error: it["status"]?.string == "failed", done: true))]
    },
    "ImageView": { it, id in [.tool(ToolItem(id: id, name: "View", target: fileOf(text(it["path"])), error: false, done: true))] },
    "Extension": { it, id in
        let name = it["kind"]?.string == "web.search" ? "WebSearch" : text(it["kind"])
        return [.tool(ToolItem(id: id, name: name, target: text(it["query"]), error: false, done: true))]
    },
    "ContextCompaction": { _, _ in [.note(.compacted, text: nil)] },
]

private func completed(_ it: JSON, at: Int64) -> [Entry] {
    let id = text(it["id"])
    if it["type"]?.string == "UserMessage" {
        let content = objects(it["content"])
        let words = content.filter { $0["type"]?.string == "text" }.map { text($0["text"]) }.joined(separator: "\n")
        let images = content.filter { $0["type"]?.string == "local_image" }.map { text($0["path"]) }
        let said = !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty
        return said ? [.you(id: id, at: at, Asked(text: words, images: images))] : []
    }
    return items[text(it["type"])].map { read in read(it, id).map { .item(at: at, $0) } } ?? []
}

func codexEntries(_ lines: [JSON]) -> [Entry] {
    lines.filter(isObject).flatMap { line -> [Entry] in
        let p = line["payload"]
        let type = line["type"]?.string
        if type == "turn_context" {
            guard let model = p?["model"]?.string else { return [] }
            return [.model([model, text(p?["effort"])].filter { !$0.isEmpty }.joined(separator: " "))]
        }
        guard type == "event_msg" else { return [] }
        switch p?["type"]?.string {
        case "item_completed":
            guard let item = p?["item"], isObject(item) else { return [] }
            return completed(item, at: number(p?["completed_at_ms"]) ?? isoTime(line["timestamp"]))
        case "task_complete":
            return [.end(took: number(p?["duration_ms"]))]
        case "turn_aborted":
            return [.item(at: isoTime(line["timestamp"]), .note(.interrupted, text: nil)), .end(took: number(p?["duration_ms"]))]
        default:
            return []
        }
    }
}
