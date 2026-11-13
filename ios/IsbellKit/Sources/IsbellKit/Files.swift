// A machine's files through its gateway: a directory one level at a time, files found by path, a
// repository's worktrees, a file read as a stream, one sent for an agent, and the git repository a
// directory is in. Paths sent are absolute. As web/src/model/files/{remote,repo,content}.ts.

import Foundation
import os

/// Opens a stream on machine `mid`, as `RelayConnection.open` does.
public typealias Opener = @MainActor (_ mid: String, _ m: String, _ p: JSON, _ timeout: Duration,
                                      _ events: StreamEvents) async throws(CallError) -> (result: JSON, stream: RpcStream)

/// `bytes` is left out when what is read would be larger than the reader's limit. `offset`: where
/// the bytes begin, for a read with a range; a gateway too old for ranges reads from the start and
/// gives none.
public struct FileRead: Sendable, Equatable {
    public var size: Int
    public var bytes: Data?
    public var offset: Int?
    /// When it was last changed, in ms, where the gateway says.
    public var mtime: Int64?
}

/// Where a read starts, in bytes from the start or from the end, and how much of it is wanted.
public struct FileRange: Sendable, Equatable {
    public var offset: Int?
    public var tail: Int?
    public var want: Int?

    public init(offset: Int? = nil, tail: Int? = nil, want: Int? = nil) {
        self.offset = offset
        self.tail = tail
        self.want = want
    }
}

public struct DirEntry: Sendable, Equatable {
    public enum Kind: String, Sendable { case dir, file, other }
    public var name: String
    public var kind: Kind
    public var size: Int64?
    public var mtime: Int64?
}

/// `total` counts the directory's entries; more than `entries` when the listing was cut.
public struct Listing: Sendable, Equatable {
    public var entries: [DirEntry]
    public var total: Int
    public var truncated: Bool
}

/// Paths relative to the root searched, shallow first.
public struct Found: Sendable, Equatable {
    public var paths: [String]
    public var truncated: Bool
}

/// A worktree as the gateway reports it; `here`: the directory asked about.
public struct Worktree: Sendable, Equatable {
    public var path: String
    public var branch: String?
    public var here: Bool

    public init(path: String, branch: String?, here: Bool) {
        self.path = path
        self.branch = branch
        self.here = here
    }
}

/// Above this a file is not read for its preview.
public let previewMax = 5 << 20

/// The gateway stops a search after 2 s; the rest is the trip.
private let fileTimeout: Duration = .seconds(20)
/// Over this a file is not sent.
public let uploadMax = 20 << 20
/// Over the relay a client may send 50 messages a second, and the app sends others meanwhile; one
/// chunk every 40 ms leaves them room.
private let chunkEvery: Duration = .milliseconds(40)

/// The entries of directory `path`, folders first.
@MainActor
public func listDir(_ call: Caller, mid: String, path: String) async throws(CallError) -> Listing {
    let r = try await call(mid, "isbell.file.list", .object(["path": .string(path)]), fileTimeout)
    guard case .array(let items)? = r["entries"], let total = r["total"]?.uint, let truncated = r["truncated"]?.bool
    else { throw badResponse("a listing") }
    let entries = items.compactMap { e -> DirEntry? in
        guard let name = e["name"]?.string, let kind = e["kind"]?.string.flatMap(DirEntry.Kind.init) else { return nil }
        return DirEntry(name: name, kind: kind, size: time(e["size"]), mtime: time(e["mtime"]))
    }
    return Listing(entries: entries, total: Int(total), truncated: truncated)
}

/// The files under `root` whose path holds `query`, ignoring case.
@MainActor
public func searchFiles(_ call: Caller, mid: String, root: String, query: String) async throws(CallError) -> Found {
    let r = try await call(mid, "isbell.file.search", .object(["root": .string(root), "query": .string(query)]), fileTimeout)
    guard case .array(let paths)? = r["paths"], let truncated = r["truncated"]?.bool else { throw badResponse("a search") }
    return Found(paths: paths.compactMap(\.string), truncated: truncated)
}

/// The worktrees of the repository `path` is in, its main checkout first; none outside one.
@MainActor
public func worktrees(_ call: Caller, mid: String, path: String) async throws(CallError) -> [Worktree] {
    let r = try await call(mid, "isbell.git.worktrees", .object(["path": .string(path)]), fileTimeout)
    guard case .array(let trees)? = r["worktrees"] else { throw badResponse("the worktrees") }
    return trees.compactMap { t in
        t["path"]?.string.map { Worktree(path: $0, branch: t["branch"]?.string, here: t["here"]?.bool ?? false) }
    }
}

private func badResponse(_ what: String) -> CallError { CallError(code: "bad_response", msg: "\(what) of another shape") }

/// The text a file holds; nil for one with a NUL byte, or not UTF-8, as a binary file is.
public func decodeText(_ bytes: Data) -> String? {
    guard !bytes.contains(0) else { return nil }
    return String(data: bytes, encoding: .utf8)
}

/// What a read has taken in so far, and its end once it comes.
@MainActor
private final class Reading {
    let limit: Int
    /// Where a read that wants less than the rest stops; otherwise it goes to the end.
    var stopAt = Int.max
    var bytes = Data()
    var stream: RpcStream?
    private var waiting: CheckedContinuation<RpcError?, Never>?
    private var outcome: RpcError??

    init(limit: Int) { self.limit = limit }

    func take(_ chunk: Data) {
        bytes.append(chunk)
        // Enough is read, or the file grew past the limit while being read: it stops here.
        if bytes.count >= stopAt || bytes.count > limit {
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

/// Reads the file at `path`, or only its size when what is read would be larger than `limit`. With
/// `range`, from where it says, as far as it wants. With `previous`, a read of the same file with the
/// same `limit` and `range`, a file found as it was then is not sent again: `previous` comes back.
@MainActor
public func readFile(_ open: Opener, mid: String, path: String, limit: Int, range: FileRange = FileRange(),
                     previous: FileRead? = nil) async throws(CallError) -> FileRead
{
    let reading = Reading(limit: limit)
    let events = StreamEvents(data: { reading.take($0) }, end: { reading.finish($0) })
    var params: [String: JSON] = ["path": .string(path)]
    if let offset = range.offset { params["offset"] = .int(Int64(offset)) }
    if let tail = range.tail { params["tail"] = .int(Int64(tail)) }
    let (result, stream) = try await open(mid, "isbell.file.read", .object(params), fileTimeout, events)
    reading.stream = stream
    guard let size = result["size"]?.uint.map(Int.init) else {
        stream.close()
        throw CallError(code: "bad_response", msg: "a file read without its size")
    }
    let offset = result["offset"]?.uint.map(Int.init)
    let mtime = time(result["mtime"])
    // Closed before any credit is granted, the file is not sent.
    if let previous, mtime != nil, previous.mtime == mtime, previous.size == size, previous.offset == offset {
        stream.close()
        return previous
    }
    let opened = FileRead(size: size, bytes: nil, offset: offset, mtime: mtime)
    let rest = size - (offset ?? 0)
    let need = min(range.want ?? rest, rest)
    if need > limit {
        stream.close()
        return opened
    }
    if need <= 0 {
        stream.close()
        return FileRead(size: size, bytes: Data(), offset: offset, mtime: mtime)
    }
    if need < rest { reading.stopAt = need }
    // No data comes before credit is granted, by which time the stream is known. The gateway ends
    // the stream on finding the file's end, which it looks for only with credit left: a grant of
    // just the rest would leave it waiting. A read that stops short closes the stream itself.
    stream.grant(min(reading.stopAt, streamWindow))
    if let error = await reading.ended() { throw CallError(code: error.code, msg: error.msg) }
    // More than asked for can come as the credit runs ahead; only what was asked counts.
    let bytes = reading.bytes.prefix(reading.stopAt)
    return bytes.count > limit ? FileRead(size: bytes.count, bytes: nil, offset: offset, mtime: mtime)
        : FileRead(size: size, bytes: Data(bytes), offset: offset, mtime: mtime)
}

/// What a write knows of its stream: the credit the far side gave, and its end once it comes.
@MainActor
private final class Writing {
    var credit = 0
    private(set) var outcome: RpcError??
    private var waiting: CheckedContinuation<Void, Never>?

    func grant(_ n: Int) {
        credit += n
        wake()
    }

    func finish(_ error: RpcError?) {
        if outcome == nil { outcome = .some(error) }
        wake()
    }

    /// Until more credit or the end comes, or the task is cancelled.
    func changed() async {
        await withTaskCancellationHandler {
            await withCheckedContinuation { waiting = $0 }
        } onCancel: {
            Task { @MainActor in self.wake() }
        }
    }

    private func wake() {
        waiting?.resume()
        waiting = nil
    }
}

/// Sends `bytes` to machine `mid` as a file named `name` for an agent, as fast as the machine grants
/// credit and the pace allows; the file's absolute path there.
@MainActor
public func upload(_ open: Opener, mid: String, name: String, bytes: Data,
                   progress: @escaping @MainActor (Int) -> Void) async throws(CallError) -> String
{
    let params = JSON.object(["name": .string(name), "size": .int(Int64(bytes.count))])
    let result = try await send(open, mid: mid, method: "isbell.file.upload", params: params, bytes: bytes, progress: progress)
    guard let path = result["path"]?.string else { throw CallError(code: "bad_response", msg: "an upload without its path") }
    return path
}

/// Sends `bytes` on a stream opened with `method`, as fast as credit and the relay allow; the
/// stream's result once the machine has them all.
@MainActor
private func send(_ open: Opener, mid: String, method: String, params: JSON, bytes: Data,
                  progress: @escaping @MainActor (Int) -> Void) async throws(CallError) -> JSON
{
    let writing = Writing()
    let events = StreamEvents(data: { _ in }, credit: { writing.grant($0) }, end: { writing.finish($0) })
    let (result, stream) = try await open(mid, method, params, fileTimeout, events)
    var sent = 0
    while sent < bytes.count, writing.outcome == nil, !Task.isCancelled {
        let chunk = bytes[bytes.startIndex + sent ..< bytes.startIndex + min(sent + maxChunk, bytes.count)]
        while writing.credit < chunk.count, writing.outcome == nil, !Task.isCancelled { await writing.changed() }
        guard await pause(chunkEvery), writing.outcome == nil else { break }
        stream.send(chunk: Data(chunk))
        writing.credit -= chunk.count
        sent += chunk.count
        progress(sent)
    }
    if writing.outcome == nil, !Task.isCancelled { stream.finish() }
    while writing.outcome == nil, !Task.isCancelled { await writing.changed() }
    guard let outcome = writing.outcome else {
        stream.close()
        throw CallError(code: "cancelled", msg: "the upload was stopped")
    }
    if let error = outcome { throw CallError(code: error.code, msg: error.msg) }
    return result
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
    do throws(CallError) {
        return try await worktrees(call, mid: mid, path: root).first?.path ?? root
    } catch {
        logger.warning("could not find the main checkout of \(root): \(error.msg)")
        return root
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "files")
