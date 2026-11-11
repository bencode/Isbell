// Which network a direct link crosses, told from the address it reaches the machine at. As
// web/src/model/path.ts.

import Foundation

/// How a direct link reaches the machine.
public enum LinkPath: String, Sendable {
    case lan, vpn, internet
}

/// One end of the pair ICE chose.
public struct Endpoint: Sendable, Equatable {
    /// "host" (an address on the device itself), "srflx" (as its router shows it), "prflx" (learned
    /// while connecting) or "relay" (a TURN server).
    public var type: String
    public var address: String?

    public init(type: String, address: String? = nil) {
        self.type = type
        self.address = address
    }
}

/// IPv4 ranges as (first octet, second octet's low bound, high bound).
private let privateV4: [(Int, Int, Int)] = [(10, 0, 255), (172, 16, 31), (192, 168, 168), (169, 254, 254), (127, 0, 255)]
/// 100.64.0.0/10, shared address space; Tailscale and other overlays hand it out.
private let vpnV4 = (100, 64, 127)

private func inRange(_ octets: [Int], _ range: (Int, Int, Int)) -> Bool {
    octets.count == 4 && octets[0] == range.0 && octets[1] >= range.1 && octets[1] <= range.2
}

/// Judged by the machine's end.
public func pathOf(_ remote: Endpoint) -> LinkPath {
    if remote.type == "relay" { return .internet }
    guard let address = remote.address?.lowercased() else { return remote.type == "host" ? .lan : .internet }
    if address.hasSuffix(".local") { return .lan }
    if address.wholeMatch(of: /\d+\.\d+\.\d+\.\d+/) != nil {
        let octets = address.split(separator: ".").compactMap { Int($0) }
        if privateV4.contains(where: { inRange(octets, $0) }) { return .lan }
        return inRange(octets, vpnV4) ? .vpn : .internet
    }
    // Tailscale's IPv6 prefix, inside the unique local range, so it is checked first.
    if address.hasPrefix("fd7a:115c:a1e0:") { return .vpn }
    // Unique local fc00::/7, link-local fe80::/10 and loopback.
    let local = address.prefixMatch(of: /f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:/) != nil || address == "::1"
    return local ? .lan : .internet
}
