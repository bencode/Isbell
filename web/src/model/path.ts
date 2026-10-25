// Which network a direct link crosses, told from the address it reaches the machine at.

/** How a direct link reaches the machine. */
export type Path = 'lan' | 'vpn' | 'internet'

/** One end of the pair ICE chose, as the browser's stats give it. */
export type Endpoint = {
  /** 'host' (an address on the device itself), 'srflx' (as its router shows it), 'prflx'
   * (learned while connecting) or 'relay' (a TURN server). */
  type: string
  /** Missing when the browser keeps it to itself. */
  address?: string
}

/** IPv4 ranges as [first octet, second octet's low bound, high bound]. */
const PRIVATE_V4: [number, number, number][] = [
  [10, 0, 255],
  [172, 16, 31],
  [192, 168, 168],
  [169, 254, 254],
  [127, 0, 255],
]
/** 100.64.0.0/10, shared address space; Tailscale and other overlays hand it out. */
const VPN_V4: [number, number, number] = [100, 64, 127]
/** Tailscale's IPv6 prefix, inside the unique local range, so it is checked first. */
const VPN_V6 = /^fd7a:115c:a1e0:/
/** Unique local fc00::/7, link-local fe80::/10 and loopback. */
const PRIVATE_V6 = /^(f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|::1$)/

const inRange = ([a, b]: number[], [first, low, high]: [number, number, number]) =>
  a === first && b !== undefined && b >= low && b <= high

/** Judged by the machine's end, the one whose address the browser can see. */
export function pathOf(remote: Endpoint): Path {
  if (remote.type === 'relay') return 'internet'
  const address = remote.address?.toLowerCase()
  if (!address) return remote.type === 'host' ? 'lan' : 'internet'
  if (address.endsWith('.local')) return 'lan'
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const octets = address.split('.').map(Number)
    if (PRIVATE_V4.some(range => inRange(octets, range))) return 'lan'
    return inRange(octets, VPN_V4) ? 'vpn' : 'internet'
  }
  if (VPN_V6.test(address)) return 'vpn'
  return PRIVATE_V6.test(address) ? 'lan' : 'internet'
}
