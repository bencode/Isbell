// The files sent along with a prompt: the composer adds each one's path on the agent's machine as a
// line of its own. As web/src/model/files/uploads.ts, and the images of content.ts.

import Foundation

/// The media type of an image file by its name, or nil when it is not one.
public func imageType(_ name: String) -> String? {
    // The extension, or the whole name when it has none, as the web's extensionOf.
    let dot = name.lastIndex(of: ".").flatMap { $0 > name.startIndex ? $0 : nil }
    return images[(dot.map { name[name.index(after: $0)...] } ?? name[...]).lowercased()]
}

private let images = [
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
    "avif": "image/avif", "bmp": "image/bmp", "heic": "image/heic", "heif": "image/heif", "ico": "image/x-icon",
    "svg": "image/svg+xml",
]

/// Where the gateway puts each upload: `<uploads>/<8 hex digits>/<name>` (gateway/file/write.rs).
private var uploaded: Regex<Substring> { /^\/.*\/isbell-uploads\/[0-9a-f]{8}\/[^\/]+$/ }

/// A prompt's own words, and the images sent along with it: the lines naming one uploaded for the
/// agent. Other uploads stay in the words, as do paths to an uploads directory set elsewhere.
func splitUploads(_ prompt: String) -> (text: String, images: [String]) {
    let lines = prompt.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let image = { (line: String) in
        let path = line.trimmingCharacters(in: .whitespaces)
        return path.wholeMatch(of: uploaded) != nil && imageType(path) != nil
    }
    return (lines.filter { !image($0) }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines),
            lines.filter(image).map { $0.trimmingCharacters(in: .whitespaces) })
}
