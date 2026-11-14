// The language a file's code is in, as highlight.js names it, for coloring it as it is read.

import Foundation

/// The highlight.js language of the file named `name`; nil for one it is not known for.
public func codeLanguage(_ name: String) -> String? {
    if let whole = byName[name] { return whole }
    guard let dot = name.lastIndex(of: "."), dot > name.startIndex else { return nil }
    return byExtension[name[name.index(after: dot)...].lowercased()]
}

private let byName = ["Dockerfile": "dockerfile", "Makefile": "makefile", "Gemfile": "ruby", "Podfile": "ruby"]

private let byExtension = [
    "swift": "swift", "ts": "typescript", "tsx": "typescript", "mts": "typescript", "cts": "typescript",
    "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript",
    "rs": "rust", "py": "python", "go": "go", "rb": "ruby", "java": "java", "kt": "kotlin", "kts": "kotlin",
    "c": "c", "h": "c", "cpp": "cpp", "cc": "cpp", "cxx": "cpp", "hpp": "cpp", "cs": "csharp",
    "m": "objectivec", "mm": "objectivec", "json": "json", "jsonl": "json", "yaml": "yaml", "yml": "yaml",
    "toml": "ini", "ini": "ini", "md": "markdown", "html": "xml", "htm": "xml", "xml": "xml", "plist": "xml",
    "svg": "xml", "css": "css", "scss": "scss", "less": "less", "sh": "bash", "bash": "bash", "zsh": "bash",
    "sql": "sql", "gradle": "gradle", "lua": "lua", "php": "php", "dockerfile": "dockerfile", "clj": "clojure",
    "scm": "scheme", "ex": "elixir", "exs": "elixir", "dart": "dart", "vue": "xml", "graphql": "graphql",
]
