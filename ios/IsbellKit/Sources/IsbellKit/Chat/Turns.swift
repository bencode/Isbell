// A record's entries told into turns: each question starts one, and a tool's result goes to the
// call it answers. As web/src/model/chat/turns.ts.

import Foundation

private let readers: [String: @Sendable ([JSON]) -> [Entry]] = ["claude": claudeEntries, "codex": codexEntries, "pi": piEntries]

/// Whether the chat can be read from this kind of agent's record.
public func readsRecord(_ kind: String?) -> Bool { kind.map { readers[$0] != nil } ?? false }

/// The turns in a `kind` of agent's record lines.
public func turnsOf(kind: String, lines: [JSON]) -> [ChatTurn] {
    turnsOf(readers[kind]?(lines) ?? [])
}

/// What comes before the first question is the session's opening, or the end of a turn whose start
/// is not read yet: a turn with nothing asked.
func turnsOf(_ entries: [Entry]) -> [ChatTurn] {
    var turns: [ChatTurn] = []
    var tools: [String: (turn: Int, at: Int)] = [:]
    var model: String?
    for entry in entries {
        switch entry {
        case .model(let name):
            model = name
            if let last = turns.indices.last, turns[last].model == nil { turns[last].model = name }
        case .you(let id, let at, let you):
            turns.append(ChatTurn(id: id, you: you, at: at, model: model, items: []))
        case .item(let at, let item):
            if turns.isEmpty { turns.append(ChatTurn(id: "start", at: at, model: model, items: [])) }
            let turn = turns.count - 1
            if case .tool(let tool) = item { tools[tool.id] = (turn, turns[turn].items.count) }
            turns[turn].items.append(item)
        case .result(let id, let output, let error):
            guard let place = tools[id], case .tool(var tool) = turns[place.turn].items[place.at] else { continue }
            tool.error = tool.error || error
            tool.done = true
            if !output.isEmpty { tool.output = output }
            turns[place.turn].items[place.at] = .tool(tool)
        case .end(let took):
            if let took, let last = turns.indices.last { turns[last].took = took }
        }
    }
    return turns
}

extension ChatTurn {
    init(id: String, you: Asked? = nil, at: Int64, model: String?, items: [ChatItem]) {
        self.init(id: id, you: you, at: at, took: nil, model: model, items: items)
    }
}
