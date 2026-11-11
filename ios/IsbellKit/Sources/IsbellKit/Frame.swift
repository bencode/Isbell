// Frames on the wire, as crates/isbell-proto/src/frame defines them:
//
//   text message   = JSON(header)
//   binary message = u32be(headerLen) ‖ JSON(header) ‖ body
//
// Header fields are written in the order the Rust enum declares them, `t` first.

import Foundation

public enum Role: String, Sendable {
    case client, gateway
}

public struct RpcError: Sendable, Equatable {
    public var code: String
    public var msg: String

    public init(code: String, msg: String) {
        self.code = code
        self.msg = msg
    }
}

public enum DataKind: String, Sendable {
    case frame, input, resize, ping, chunk
}

/// Which machine or connection a routed frame is for or from; written as mid, from, to.
public struct Route: Sendable, Equatable {
    public var mid: String?
    public var from: String?
    public var to: String?

    public init(mid: String? = nil, from: String? = nil, to: String? = nil) {
        self.mid = mid
        self.from = from
        self.to = to
    }
}

public struct SnapshotEntry: Sendable, Equatable {
    public var state: JSON
    public var online: Bool

    public init(state: JSON, online: Bool) {
        self.state = state
        self.online = online
    }
}

public enum Header: Sendable, Equatable {
    case challenge(nonce: String, origin: String)
    /// Only a gateway also names its machine; a client never does.
    case auth(role: Role, pk: String, sig: String)
    case authOk(sid: String, conn: String)
    case call(id: UInt64, m: String, p: JSON, route: Route)
    case res(id: UInt64, ok: Bool, r: JSON?, e: RpcError?, route: Route)
    case data(id: UInt64, k: DataKind, full: Bool?, cols: UInt16?, rows: UInt16?, route: Route)
    case end(id: UInt64, e: RpcError?, route: Route)
    case credit(id: UInt64, n: UInt64, route: Route)
    case state(JSON)
    case presence(mid: String, online: Bool)
    case snapshot([SnapshotEntry])
    /// A kind of frame this client does not know yet: read, then ignored.
    case unknown(t: String)
}

/// A frame; an empty body is normalized to none.
public struct Frame: Sendable, Equatable {
    public var header: Header
    public var body: Data?

    public init(header: Header, body: Data? = nil) {
        self.header = header
        self.body = body?.isEmpty == false ? body : nil
    }
}

public enum Message: Sendable, Equatable {
    case text(String)
    case binary(Data)
}

public struct FrameError: Error, Sendable, Equatable {
    public var reason: String
}

/// Text when there is no body, binary otherwise.
public func encode(_ frame: Frame) -> Message {
    frame.body == nil ? .text(headerText(frame.header)) : .binary(encodeBinary(frame))
}

/// `u32be(headerLen) ‖ header ‖ body`, with or without a body.
public func encodeBinary(_ frame: Frame) -> Data {
    let head = Data(headerText(frame.header).utf8)
    var out = Data()
    out.reserveCapacity(4 + head.count + (frame.body?.count ?? 0))
    withUnsafeBytes(of: UInt32(head.count).bigEndian) { out.append(contentsOf: $0) }
    out.append(head)
    if let body = frame.body { out.append(body) }
    return out
}

public func decode(_ message: Message) throws(FrameError) -> Frame {
    switch message {
    case .text(let text):
        return Frame(header: try parseHeader(Data(text.utf8)))
    case .binary(let bytes):
        let bytes = Data(bytes)  // indices from 0
        guard bytes.count >= 4 else { throw FrameError(reason: "binary frame is truncated") }
        let len = bytes.prefix(4).reduce(0) { $0 << 8 | Int($1) }
        guard len <= bytes.count - 4 else { throw FrameError(reason: "binary frame is truncated") }
        let head = bytes.subdata(in: 4..<(4 + len))
        return Frame(header: try parseHeader(head), body: bytes.subdata(in: (4 + len)..<bytes.count))
    }
}

// MARK: - Writing

func headerText(_ header: Header) -> String {
    objectText(headerFields(header))
}

private func headerFields(_ header: Header) -> [(String, String?)] {
    switch header {
    case .challenge(let nonce, let origin):
        return [("t", str("challenge")), ("nonce", str(nonce)), ("origin", str(origin))]
    case .auth(let role, let pk, let sig):
        return [("t", str("auth")), ("role", str(role.rawValue)), ("pk", str(pk)), ("sig", str(sig))]
    case .authOk(let sid, let conn):
        return [("t", str("auth_ok")), ("sid", str(sid)), ("conn", str(conn))]
    case .call(let id, let m, let p, let route):
        return [("t", str("call")), ("id", String(id)), ("m", str(m)), ("p", jsonText(p))]
            + routeFields(route, from: true, to: false)
    case .res(let id, let ok, let r, let e, let route):
        return [("t", str("res")), ("id", String(id)), ("ok", String(ok)), ("r", r.map(jsonText)), ("e", e.map(errorText))]
            + routeFields(route, from: false, to: true)
    case .data(let id, let k, let full, let cols, let rows, let route):
        return [
            ("t", str("data")), ("id", String(id)), ("k", str(k.rawValue)), ("full", full.map { String($0) }),
            ("cols", cols.map { String($0) }), ("rows", rows.map { String($0) }),
        ] + routeFields(route, from: true, to: true)
    case .end(let id, let e, let route):
        return [("t", str("end")), ("id", String(id)), ("e", e.map(errorText))]
            + routeFields(route, from: true, to: true)
    case .credit(let id, let n, let route):
        return [("t", str("credit")), ("id", String(id)), ("n", String(n))]
            + routeFields(route, from: true, to: true)
    case .state(let state):
        return [("t", str("state")), ("state", jsonText(state))]
    case .presence(let mid, let online):
        return [("t", str("presence")), ("mid", str(mid)), ("online", String(online))]
    case .snapshot(let machines):
        return [("t", str("snapshot")), ("machines", "[" + machines.map(snapshotText).joined(separator: ",") + "]")]
    case .unknown(let t):
        return [("t", str(t))]
    }
}

/// The routing fields a kind of frame has, in the Rust order.
private func routeFields(_ route: Route, from: Bool, to: Bool) -> [(String, String?)] {
    [("mid", route.mid.map(str))]
        + (from ? [("from", route.from.map(str))] : [])
        + (to ? [("to", route.to.map(str))] : [])
}

private func str(_ s: String) -> String { jsonText(.string(s)) }
private func errorText(_ e: RpcError) -> String { objectText([("code", str(e.code)), ("msg", str(e.msg))]) }
private func snapshotText(_ s: SnapshotEntry) -> String {
    objectText([("state", jsonText(s.state)), ("online", String(s.online))])
}

// MARK: - Reading

private func parseHeader(_ data: Data) throws(FrameError) -> Header {
    let value: JSON
    do {
        value = try JSONDecoder().decode(JSON.self, from: data)
    } catch {
        throw FrameError(reason: "invalid frame header: \(error)")
    }
    guard case .object = value, let t = value["t"]?.string else {
        throw FrameError(reason: "invalid frame header")
    }
    guard let header = readHeader(t, value) else {
        throw FrameError(reason: "frame header \(t) is missing a field")
    }
    return header
}

private func readHeader(_ t: String, _ v: JSON) -> Header? {
    let route = Route(mid: v["mid"]?.string, from: v["from"]?.string, to: v["to"]?.string)
    let id = v["id"]?.uint
    switch t {
    case "challenge":
        guard let nonce = v["nonce"]?.string, let origin = v["origin"]?.string else { return nil }
        return .challenge(nonce: nonce, origin: origin)
    case "auth":
        guard let role = v["role"]?.string.flatMap(Role.init), let pk = v["pk"]?.string,
              let sig = v["sig"]?.string else { return nil }
        return .auth(role: role, pk: pk, sig: sig)
    case "auth_ok":
        guard let sid = v["sid"]?.string, let conn = v["conn"]?.string else { return nil }
        return .authOk(sid: sid, conn: conn)
    case "call":
        guard let id, let m = v["m"]?.string else { return nil }
        return .call(id: id, m: m, p: v["p"] ?? .null, route: route)
    case "res":
        guard let id, let ok = v["ok"]?.bool else { return nil }
        return .res(id: id, ok: ok, r: v["r"], e: v["e"].flatMap(readError), route: route)
    case "data":
        guard let id, let k = v["k"]?.string.flatMap(DataKind.init) else { return nil }
        return .data(
            id: id, k: k, full: v["full"]?.bool, cols: v["cols"]?.uint.flatMap(UInt16.init(exactly:)),
            rows: v["rows"]?.uint.flatMap(UInt16.init(exactly:)), route: route)
    case "end":
        guard let id else { return nil }
        return .end(id: id, e: v["e"].flatMap(readError), route: route)
    case "credit":
        guard let id, let n = v["n"]?.uint else { return nil }
        return .credit(id: id, n: n, route: route)
    case "state":
        guard let state = v["state"] else { return nil }
        return .state(state)
    case "presence":
        guard let mid = v["mid"]?.string, let online = v["online"]?.bool else { return nil }
        return .presence(mid: mid, online: online)
    case "snapshot":
        guard case .array(let items)? = v["machines"] else { return nil }
        let entries = items.compactMap { item -> SnapshotEntry? in
            guard let state = item["state"], let online = item["online"]?.bool else { return nil }
            return SnapshotEntry(state: state, online: online)
        }
        return entries.count == items.count ? .snapshot(entries) : nil
    default:
        return .unknown(t: t)
    }
}

private func readError(_ v: JSON) -> RpcError? {
    guard let code = v["code"]?.string, let msg = v["msg"]?.string else { return nil }
    return RpcError(code: code, msg: msg)
}
