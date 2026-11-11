// A machine's files through its gateway: a file read as a stream, and the git repository a
// directory is in. As web/src/model/files/{remote,repo}.ts, for what this client reads so far.

import Foundation
import os

/// Opens a stream on machine `mid`, as `RelayConnection.open` does.
public typealias Opener = @MainActor (_ mid: String, _ m: String, _ p: JSON, _ timeout: Duration,
                                      _ events: StreamEvents) async throws(CallError) -> (result: JSON, stream: RelayStream)

/// `bytes` is left out when the file is larger than the reader's limit.
public struct FileRead: Sendable, Equatable {
    public var size: Int
    public var bytes: Data?
}

/// The gateway stops a search after 2 s; the rest is the trip.
private let fileTimeout: Duration = .seconds(20)

/// What a read has taken in so far, and its end once it comes.
@MainActor
private final class Reading {
    let limit: Int
    var bytes = Data()
    var stream: RelayStream?
    private var waiting: CheckedContinuation<RpcError?, Never>?
    private var outcome: RpcError??

    init(limit: Int) { self.limit = limit }

    func take(_ chunk: Data) {
        bytes.append(chunk)
        // The file grew past the limit while being read: it stops here.
        if bytes.count > limit {
            stream?.close()
            finish(nil)
        } else {
            stream?.consumed(chunk.count)
        }
    }

    func finish(_ error: RpcError?) {
        guard outcome == nil else { return }
        outcome = .some(error)
        waiting?.resume(returning: error)
        waiting = nil
    }

    func ended() async -> RpcError? {
        if let outcome { return outcome }
        return await withCheckedContinuation { waiting = $0 }
    }
}

/// Reads the file at `path`, or only its size when it is larger than `limit`.
@MainActor
public func readFile(_ open: Opener, mid: String, path: String, limit: Int) async throws(CallError) -> FileRead {
    let reading = Reading(limit: limit)
    let events = StreamEvents(data: { reading.take($0) }, end: { reading.finish($0) })
    let (result, stream) = try await open(mid, "isbell.file.read", .object(["path": .string(path)]), fileTimeout, events)
    reading.stream = stream
    guard let size = result["size"]?.uint.map(Int.init) else {
        stream.close()
        throw CallError(code: "bad_response", msg: "a file read without its size")
    }
    if size > limit {
        stream.close()
        return FileRead(size: size, bytes: nil)
    }
    if size == 0 {
        stream.close()
        return FileRead(size: 0, bytes: Data())
    }
    // No data comes before credit is granted, by which time the stream is known. The gateway ends
    // the stream on finding the file's end, which it looks for only with credit left: a grant of
    // just `size` would leave it waiting.
    stream.grant(streamWindow)
    if let error = await reading.ended() { throw CallError(code: error.code, msg: error.msg) }
    let bytes = reading.bytes
    return bytes.count > limit ? FileRead(size: bytes.count, bytes: nil) : FileRead(size: size, bytes: bytes)
}

/// A home directory or above is never a project's root, even when it is a repository.
public func isBroad(_ path: String) -> Bool {
    path == "/" || path == "/root" || path.wholeMatch(of: /\/(?:Users|home)(?:\/[^\/]+)?/) != nil
}

/// The directories from `dir` up that may be a repository's root, deepest first.
public func repoCandidates(_ dir: String) -> [String] {
    let parts = trimSlash(dir).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    return (0..<parts.count)
        .map { parts[0..<(parts.count - $0)].joined(separator: "/") }
        .filter { $0.hasPrefix("/") && !isBroad($0) }
}

private enum GitAt: Sendable { case dir, file }

/// The root of the git repository that `dir` is in: its main checkout, for a directory in a
/// worktree; nil when it is in none.
@MainActor
public func repoRootOf(_ call: @escaping Caller, mid: String, dir: String) async throws(CallError) -> String? {
    let candidates = repoCandidates(dir)
    // Asked all at once; the deepest that has a `.git` wins.
    let asking = candidates.map { path in
        Task { () async -> Result<GitAt?, CallError> in
            do throws(CallError) {
                return .success(try await gitAt(call, mid, path))
            } catch {
                return .failure(error)
            }
        }
    }
    var held: [GitAt?] = []
    for task in asking { held.append(try await task.value.get()) }
    guard let at = held.firstIndex(where: { $0 != nil }) else { return nil }
    let root = candidates[at]
    return held[at] == .file ? await mainCheckout(call, mid, root) : root
}

/// What `dir` has for a `.git`: a directory, or the file a worktree or a submodule has.
@MainActor
private func gitAt(_ call: Caller, _ mid: String, _ dir: String) async throws(CallError) -> GitAt? {
    do {
        _ = try await call(mid, "isbell.file.list", .object(["path": .string("\(dir)/.git")]), fileTimeout)
        return .dir
    } catch where error.code == "not_a_directory" {
        return .file
    } catch where error.code == "not_found" {
        return nil
    }
}

/// The first of a repository's worktrees is its main checkout. A machine that cannot say leaves the
/// worktree as a root of its own.
@MainActor
private func mainCheckout(_ call: Caller, _ mid: String, _ root: String) async -> String {
    do {
        let r = try await call(mid, "isbell.git.worktrees", .object(["path": .string(root)]), fileTimeout)
        guard case .array(let trees)? = r["worktrees"] else { return root }
        return trees.first?["path"]?.string ?? root
    } catch {
        logger.warning("could not find the main checkout of \(root): \(error.msg)")
        return root
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "files")
