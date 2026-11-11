// What a tool call is shown by: the one argument that says what it works on, and for an edit the
// lines it added and removed. As web/src/model/chat/tools.ts.

import Foundation

private let field: [String: String] = [
    "Bash": "command", "Read": "file_path", "Edit": "file_path", "MultiEdit": "file_path",
    "Write": "file_path", "NotebookEdit": "notebook_path", "Grep": "pattern", "Glob": "pattern",
    "Agent": "description", "Task": "description", "WebFetch": "url", "WebSearch": "query", "Skill": "skill",
]

private func firstLine(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n", omittingEmptySubsequences: false)
        .first.map(String.init) ?? ""
}

/// The argument the call works on, its first line; else its first text argument.
func targetOf(_ name: String, _ input: JSON?) -> String {
    guard case .object(let fields)? = input else { return "" }
    if let own = field[name].flatMap({ fields[$0]?.string }) { return firstLine(own) }
    // JSON objects keep no order once parsed; the first by key stands in for the first written.
    let any = fields.sorted { $0.key < $1.key }.lazy.compactMap { $0.value.string }.first
    return any.map(firstLine) ?? ""
}

private func lineCount(_ value: JSON?) -> Int {
    guard let s = value?.string, !s.isEmpty else { return 0 }
    return s.split(separator: "\n", omittingEmptySubsequences: false).count
}

/// Lines added and removed by an edit or a write.
func editOf(_ name: String, _ input: JSON?) -> EditCount? {
    guard let input, isObject(input) else { return nil }
    if name == "Write" { return EditCount(add: lineCount(input["content"]), del: 0) }
    guard name == "Edit" || name == "MultiEdit" else { return nil }
    // Claude Code's edits, or pi's.
    let edits: [JSON] = if case .array? = input["edits"] { objects(input["edits"]) } else { [input] }
    return edits.reduce(EditCount(add: 0, del: 0)) { sum, e in
        EditCount(add: sum.add + lineCount(e["new_string"] ?? e["newText"]),
                  del: sum.del + lineCount(e["old_string"] ?? e["oldText"]))
    }
}

/// Lines a unified diff adds and removes.
func diffOf(_ diff: String) -> EditCount {
    let rows = diff.split(separator: "\n", omittingEmptySubsequences: false)
    return EditCount(add: rows.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count,
                     del: rows.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count)
}

/// A model as people say it: claude-opus-5-5 as opus 5.5.
public func modelName(_ id: String) -> String {
    if let m = id.wholeMatch(of: /claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?/) { return "\(m.1) \(m.2).\(m.3)" }
    return id.hasPrefix("claude-") ? String(id.dropFirst("claude-".count)) : id
}
