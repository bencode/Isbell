import Testing

@testable import IsbellKit

private let rec = StartTemplate(name: "Claude · rec", agent: "claude", command: "reclaude")

private func file(_ templates: [[String: String]], version: Int = 1) -> String {
    let entries = templates.map { t in
        "{" + t.sorted { $0.key < $1.key }.map { "\"\($0.key)\":\"\($0.value)\"" }.joined(separator: ",") + "}"
    }
    return "{\"version\":\(version),\"templates\":[\(entries.joined(separator: ","))]}"
}

private func entry(_ t: StartTemplate) -> [String: String] {
    ["name": t.name, "agent": t.agent, "command": t.command]
}

@Test func aFileIsReadWholeOrNotAtAllWhereAnyTemplateInItCouldNotBeUsed() {
    #expect(parseTemplates(file((defaultTemplates + [rec]).map(entry))) == defaultTemplates + [rec])
    #expect(parseTemplates(file([entry(rec)], version: 2)) == nil)
    #expect(parseTemplates(file([["name": "x", "agent": "gemini", "command": "gemini"]])) == nil)
    #expect(parseTemplates(file([["name": "x", "agent": "claude"]])) == nil)
    #expect(parseTemplates(file([entry(rec), ["name": "Claude · rec ", "agent": "claude", "command": "claude"]])) == nil)
    #expect(parseTemplates(file([["name": " ", "agent": "claude", "command": "claude"]])) == nil)
    #expect(parseTemplates(file([["name": "x", "agent": "claude", "command": "reclaude\\nrm -rf ~"]])) == nil)
    #expect(parseTemplates("not json") == nil)
}

@Test func whatIsNotListedStartsEachAgentByItsOwnName() {
    #expect(templatesOf(.listed([rec])) == [rec])
    #expect(templatesOf(.missing) == defaultTemplates)
    #expect(templatesOf(.broken) == defaultTemplates)
    #expect(templatesOf(nil) == defaultTemplates)
    #expect(defaultTemplates.allSatisfy(plain))
    #expect(!plain(rec))
}

@Test func aCommandOfItsOwnNeedsAGatewayThatLaunches() {
    let old = Caps(methods: ["isbell.agent.start"], agentKinds: ["claude", "codex"])
    let new = Caps(methods: ["isbell.agent.start", launchMethod], agentKinds: ["claude", "codex"])
    let claude = defaultTemplates[0]
    #expect(usable(claude, old))
    #expect(!usable(rec, old))
    #expect(usable(rec, new))
    #expect(!usable(StartTemplate(name: "pi", agent: "pi", command: "pi"), new))
}
