// pi's session file: its messages (what was asked, the replies with their thinking and tool calls,
// and the tools' results), each with the model it came from. As web/src/model/chat/pi.ts.

import Foundation

/// pi's tools by Claude Code's names, as the hook reports them.
private let tools = ["bash": "Bash", "read": "Read", "write": "Write", "edit": "Edit", "grep": "Grep", "find": "Glob"]

/// pi names the file a tool works on `path`; Claude Code, `file_path`.
private func inputOf(_ args: JSON?) -> JSON? {
    guard case .object(var fields)? = args, let path = fields["path"] else { return args }
    fields["file_path"] = path
    return .object(fields)
}

/// An entry's place in pi's session tree, which `/tree` branches.
private func nodeOf(_ line: JSON) -> Node? {
    guard let id = line["id"]?.string else { return nil }
    let asks = line["type"]?.string == "message" && line["message"]?["role"]?.string == "user"
    return Node(id: id, parent: text(line["parentId"]), asks: asks)
}

func piEntries(_ lines: [JSON]) -> [Entry] {
    standing(lines.filter(isObject), nodeOf: nodeOf).flatMap { line -> [Entry] in
        guard line["type"]?.string == "message", let m = line["message"], isObject(m) else { return [] }
        let at = number(m["timestamp"]) ?? isoTime(line["timestamp"])
        let blocks = objects(m["content"])
        switch m["role"]?.string {
        case "user":
            let words = blocks.filter { $0["type"]?.string == "text" }.map { text($0["text"]) }.joined(separator: "\n")
            let data = blocks.filter { $0["type"]?.string == "image" }
                .map { "data:\(text($0["mimeType"]));base64,\(text($0["data"]))" }
            let (said, images) = splitUploads(words)
            guard !said.isEmpty || !images.isEmpty || !data.isEmpty else { return [] }
            let id = line["id"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? String(at)
            return [.you(id: id, at: at, Asked(text: said, images: images, data: data))]
        case "toolResult":
            return [.result(id: text(m["toolCallId"]), output: blocks.map { text($0["text"]) }.joined(separator: "\n"),
                            error: m["isError"]?.bool == true)]
        case "assistant":
            return assistant(m, at: at, blocks)
        default:
            return []
        }
    }
}

private func assistant(_ m: JSON, at: Int64, _ blocks: [JSON]) -> [Entry] {
    let model: [Entry] = m["model"]?.string.map { [.model($0)] } ?? []
    let said = blocks.compactMap { b -> Entry? in
        switch b["type"]?.string {
        case "text" where !text(b["text"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
            return .item(at: at, .text(text(b["text"])))
        case "thinking" where !text(b["thinking"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
            return .item(at: at, .thinking(text(b["thinking"]), ms: nil))
        case "toolCall":
            let name = tools[text(b["name"])] ?? text(b["name"])
            let input = inputOf(b["arguments"])
            return .item(at: at, .tool(ToolItem(id: text(b["id"]), name: name, target: targetOf(name, input),
                                                error: false, edit: editOf(name, input), done: false)))
        default:
            return nil
        }
    }
    let stop = m["stopReason"]?.string
    let failed: [Entry] = switch stop {
    case "error": [.item(at: at, .note(.failed, text: text(m["errorMessage"])))]
    case "aborted": [.item(at: at, .note(.interrupted, text: nil))]
    default: []
    }
    // A reply that called no tool ends the turn.
    return model + said + failed + (stop == "toolUse" ? [] : [.end(took: nil)])
}
