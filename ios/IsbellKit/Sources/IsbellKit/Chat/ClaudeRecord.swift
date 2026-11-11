// Claude Code's transcript (a JSON line per message part): what was asked, the replies, thinking
// and tool calls of the main conversation, the tools' results, and how long each turn took.
// As web/src/model/chat/claude.ts.

import Foundation

/// Text Claude Code adds of its own: a task's end, reminders, a command's output.
// Regex values are not Sendable, so each is made where used.
private var own: Regex<(Substring, Substring)> { /^\s*<(task-notification|system-reminder|local-command-stdout|local-command-caveat|bash-stdout|bash-input)/ }
private var command: Regex<(Substring, Substring)> { /<command-name>(.*?)<\/command-name>/ }
private var args: Regex<(Substring, Substring)> { /<command-args>((?:.|\n)*?)<\/command-args>/ }

private func blocksOf(_ content: JSON?) -> [JSON] {
    if let s = content?.string { return [.object(["type": .string("text"), "text": .string(s)])] }
    return objects(content)
}

private func resultText(_ content: JSON?) -> String {
    content?.string ?? blocksOf(content).map { text($0["text"]) }.joined(separator: "\n")
}

private enum Said {
    case asked(Asked)
    case interrupted
}

/// What the user said in a line, if it is theirs.
private func asked(_ blocks: [JSON]) -> Said? {
    let said = blocks.filter { $0["type"]?.string == "text" }.map { text($0["text"]) }.joined(separator: "\n")
    let data = blocks.compactMap { b -> String? in
        let s = b["source"]
        guard b["type"]?.string == "image", s?["type"]?.string == "base64" else { return nil }
        return "data:\(text(s?["media_type"]));base64,\(text(s?["data"]))"
    }
    if said.hasPrefix("[Request interrupted") { return .interrupted }
    if said.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && data.isEmpty { return nil }
    if said.prefixMatch(of: own) != nil { return nil }
    let words = said.firstMatch(of: command).map { name in
        "\(name.1) \(said.firstMatch(of: args).map { String($0.1) } ?? "")".trimmingCharacters(in: .whitespacesAndNewlines)
    } ?? said
    let (rest, images) = splitUploads(words)
    return .asked(Asked(text: rest, images: images, data: data))
}

/// A main-conversation line's place: a question is a user line that is not a tool's result.
private func nodeOf(_ line: JSON) -> Node? {
    guard let id = line["uuid"]?.string, line["isSidechain"]?.bool != true else { return nil }
    let asks = line["type"]?.string == "user" && line["isMeta"]?.bool != true
        && !blocksOf(line["message"]?["content"]).contains { $0["type"]?.string == "tool_result" }
    return Node(id: id, parent: text(line["parentUuid"]), asks: asks)
}

func claudeEntries(_ lines: [JSON]) -> [Entry] {
    var before: Int64 = 0
    return standing(lines.filter(isObject), nodeOf: nodeOf).flatMap { line -> [Entry] in
        let at = isoTime(line["timestamp"])
        let was = before
        if at != 0 { before = at }
        let type = line["type"]?.string
        if type == "system" {
            if line["subtype"]?.string == "turn_duration", let ms = number(line["durationMs"]) { return [.end(took: ms)] }
            if line["subtype"]?.string == "compact_boundary" { return [.item(at: at, .note(.compacted, text: nil))] }
            return []
        }
        if line["isSidechain"]?.bool == true || line["isMeta"]?.bool == true || line["isCompactSummary"]?.bool == true {
            return []
        }
        let message = line["message"]
        let blocks = blocksOf(message?["content"])
        if type == "user" {
            let results = blocks.compactMap { b -> Entry? in
                guard b["type"]?.string == "tool_result" else { return nil }
                return .result(id: text(b["tool_use_id"]), output: resultText(b["content"]), error: b["is_error"]?.bool == true)
            }
            if !results.isEmpty { return results }
            return switch asked(blocks) {
            case .interrupted?: [.item(at: at, .note(.interrupted, text: nil))]
            case .asked(let you)?: [.you(id: line["uuid"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? String(at), at: at, you)]
            case nil: []
            }
        }
        guard type == "assistant" else { return [] }
        let model: [Entry] = message?["model"]?.string.flatMap { $0 == "<synthetic>" ? nil : [.model($0)] } ?? []
        return model + blocks.compactMap { b -> Entry? in
            switch b["type"]?.string {
            case "text" where !text(b["text"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
                return .item(at: at, .text(text(b["text"])))
            case "thinking" where !text(b["thinking"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
                return .item(at: at, .thinking(text(b["thinking"]), ms: was != 0 && at > was ? at - was : nil))
            case "tool_use":
                let name = text(b["name"])
                return .item(at: at, .tool(ToolItem(id: text(b["id"]), name: name, target: targetOf(name, b["input"]),
                                                    error: false, edit: editOf(name, b["input"]), done: false)))
            default:
                return nil
            }
        }
    }
}
