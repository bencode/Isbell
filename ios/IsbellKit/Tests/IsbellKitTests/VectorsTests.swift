// The protocol vectors Rust and TypeScript check themselves against, from
// crates/isbell-proto/tests/vectors.json.

import CryptoKit
import Foundation
import Testing

@testable import IsbellKit

private let vectors: JSON = {
    let root = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let data = try! Data(contentsOf: root.appending(path: "crates/isbell-proto/tests/vectors.json"))
    return try! JSONDecoder().decode(JSON.self, from: data)
}()

private func field(_ v: JSON?, _ key: String) -> String { v?[key]?.string ?? "" }

private func hex(_ text: String) -> Data {
    Data(stride(from: 0, to: text.count, by: 2).map { i in
        let start = text.index(text.startIndex, offsetBy: i)
        return UInt8(text[start..<text.index(start, offsetBy: 2)], radix: 16)!
    })
}

private func unbase64url(_ text: String) -> Data {
    var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while s.count % 4 != 0 { s += "=" }
    return Data(base64Encoded: s)!
}

@Test func identityMatches() throws {
    let v = vectors["identity"]
    let id = try parseKey(field(v, "key"))
    #expect(id.key == field(v, "key"))
    #expect(id.pk == field(v, "pk"))
    #expect(id.sid == field(v, "sid"))
    #expect(field(v, "role") == Role.client.rawValue)
    let message = authMessage(role: .client, origin: field(v, "origin"), nonce: field(v, "nonce"))
    #expect(message == field(v, "authMessage"))

    // CryptoKit's signatures carry randomness: the vector's must verify, and so must ours.
    let pk = try Curve25519.Signing.PublicKey(rawRepresentation: unbase64url(id.pk))
    #expect(pk.isValidSignature(unbase64url(field(v, "sig")), for: Data(message.utf8)))
    let ours = signAuth(id, role: .client, origin: field(v, "origin"), nonce: field(v, "nonce"))
    #expect(pk.isValidSignature(unbase64url(ours), for: Data(message.utf8)))
}

@Test func badKeysAreRejectedForTheStatedReason() {
    guard case .array(let cases)? = vectors["badKeys"] else { Issue.record("no badKeys"); return }
    for c in cases {
        let expected: KeyError? = ["prefix": .prefix, "encoding": .encoding, "checksum": .checksum][field(c, "error")]
        #expect(throws: expected!) { try parseKey(field(c, "key")) }
    }
}

@Test func framesEncodeToTheStatedBytes() throws {
    guard case .array(let cases)? = vectors["frames"] else { Issue.record("no frames"); return }
    for c in cases {
        let wire: Message = c["text"]?.string.map(Message.text) ?? .binary(hex(field(c, "binaryHex")))
        let expected = try decode(.text(jsonText(c["header"]!))).header
        let frame = try decode(wire)
        #expect(frame.header == expected, "\(c)")
        #expect(frame.body == c["bodyHex"]?.string.map(hex), "\(c)")
        #expect(encode(frame) == wire, "\(c)")
    }
}
