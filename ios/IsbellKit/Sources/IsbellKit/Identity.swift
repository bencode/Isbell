// Space identity, as crates/isbell-proto/src/identity.rs defines it:
//
//   key string = "isbk1-" ‖ base32lower(secret ‖ sha256(secret)[0..2])
//   seed       = HKDF-SHA256(ikm = secret, salt = ∅, info = "isbell-ed25519-v1", L = 32)
//   (sk, pk)   = Ed25519(seed)
//   sid        = base32lower(sha256(pk))[0..16]
//
// CryptoKit signs with added randomness, so a signature differs from the other ends' bytes while
// still verifying under the same public key.

import CryptoKit
import Foundation

private let keyPrefix = "isbk1-"
private let secretLen = 16
private let checksumLen = 2
private let seedInfo = Data("isbell-ed25519-v1".utf8)
private let authDomain = "isbell-auth-v1"
private let sidLen = 16

public struct Identity: Sendable {
    /// The key in its canonical form.
    public let key: String
    /// The public key, base64url without padding.
    public let pk: String
    public let sid: String
    let signingKey: Curve25519.Signing.PrivateKey
}

public enum KeyError: Error, Sendable, Equatable {
    case prefix, encoding, checksum
}

public func parseKey(_ input: String) throws(KeyError) -> Identity {
    let key = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard key.hasPrefix(keyPrefix) else { throw .prefix }
    guard let bytes = base32Decode(String(key.dropFirst(keyPrefix.count)).lowercased()),
          bytes.count == secretLen + checksumLen
    else { throw .encoding }
    let secret = bytes.prefix(secretLen)
    guard Data(SHA256.hash(data: secret)).prefix(checksumLen) == bytes.suffix(checksumLen) else {
        throw .checksum
    }
    let seed = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: secret), info: seedInfo, outputByteCount: 32)
    // A 32-byte seed is always a valid Ed25519 private key.
    let signingKey = try! Curve25519.Signing.PrivateKey(rawRepresentation: seed.withUnsafeBytes { Data($0) })
    let pk = signingKey.publicKey.rawRepresentation
    return Identity(
        key: keyPrefix + base32Encode(bytes),
        pk: base64url(pk),
        sid: String(base32Encode(Data(SHA256.hash(data: pk))).prefix(sidLen)),
        signingKey: signingKey)
}

public func authMessage(role: Role, origin: String, nonce: String) -> String {
    "\(authDomain)\n\(role.rawValue)\n\(origin)\n\(nonce)"
}

public func signAuth(_ id: Identity, role: Role, origin: String, nonce: String) -> String {
    // Signing fails only when the system's crypto does; there is nothing to recover then.
    let sig = try! id.signingKey.signature(for: Data(authMessage(role: role, origin: origin, nonce: nonce).utf8))
    return base64url(sig)
}

/// `scheme://host[:port]` of a ws/wss URL, as the relay signs it into its challenge.
public func originOf(_ url: URL) -> String? {
    guard let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss",
          let host = url.host(percentEncoded: false)?.lowercased(), !host.isEmpty
    else { return nil }
    return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
}

/// What was pasted: the key after `#k=` in a link, or the text itself.
public func keyText(fromPasted text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let range = trimmed.range(of: "#k=") else { return trimmed }
    let rest = String(trimmed[range.upperBound...])
    return (rest.removingPercentEncoding ?? rest).trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Encodings

private let base32Alphabet = Array("abcdefghijklmnopqrstuvwxyz234567".utf8)

private func base32Encode(_ data: Data) -> String {
    var out = [UInt8]()
    var buffer = 0
    var bits = 0
    for byte in data {
        buffer = buffer << 8 | Int(byte)
        bits += 8
        while bits >= 5 {
            out.append(base32Alphabet[(buffer >> (bits - 5)) & 31])
            bits -= 5
        }
    }
    if bits > 0 { out.append(base32Alphabet[(buffer << (5 - bits)) & 31]) }
    return String(decoding: out, as: UTF8.self)
}

/// Lowercase, unpadded; nil for a character outside the alphabet or leftover bits that are not zero.
private func base32Decode(_ text: String) -> Data? {
    var out = Data()
    var buffer = 0
    var bits = 0
    for c in text.utf8 {
        guard let value = base32Alphabet.firstIndex(of: c) else { return nil }
        buffer = (buffer << 5 | value) & 0xFFFF
        bits += 5
        if bits >= 8 {
            out.append(UInt8((buffer >> (bits - 8)) & 0xFF))
            bits -= 8
        }
    }
    guard bits < 5, buffer & ((1 << bits) - 1) == 0 else { return nil }
    return out
}

private func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
