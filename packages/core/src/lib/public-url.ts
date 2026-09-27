import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { isIP } from 'node:net'

/**
 * Keeps outgoing webhooks pointed at the public internet.
 *
 * An admin types the webhook URL, and the worker then POSTs signed payloads to
 * it from inside our network. Without this, that URL could name the database,
 * Redis, a cloud metadata endpoint, or anything else only reachable from here.
 *
 * Checking the hostname once when the URL is saved is not enough: DNS can
 * answer differently later ("rebinding"). So the same test also runs as the
 * connection's own DNS lookup, on the address actually being dialled.
 */

/** 4 octets -> 32-bit number. */
function v4ToInt(ip: string) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0
}

function inV4(ip: string, base: string, bits: number) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask)
}

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
]

/** Expands an IPv6 address into 8 numeric groups, or null if malformed. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)

  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes the last two groups.
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    if (isIP(tail[1]!) !== 4) return null
    const n = v4ToInt(tail[1]!)
    s = s.slice(0, -tail[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0) return null
  const groups = [...head, ...Array(fill).fill('0'), ...rest]
  if (groups.length !== 8) return null
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return nums.some(Number.isNaN) ? null : nums
}

/** True for any address that is not ordinary, publicly routable unicast. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return PRIVATE_V4.some(([base, bits]) => inV4(ip, base, bits))
  if (family !== 6) return true // not an address at all: refuse rather than guess

  const g = v6Groups(ip)
  if (!g) return true

  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`

  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 inside.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateAddress(embeddedV4())
  // NAT64 (64:ff9b::a.b.c.d) reaches whatever IPv4 it embeds.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(embeddedV4())
  if ((g[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  return false
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface PublicUrlOptions {
  /**
   * Let plain http to localhost through - a receiver script on the developer's
   * own machine. Never on in production.
   */
  allowLocalhost: boolean
}

/** Whether this URL is the localhost exception rather than a public target. */
export function isLocalhostUrl(url: URL) {
  return LOOPBACK_NAMES.has(url.hostname)
}

/**
 * Validates a webhook target. Returns an error message for the admin, or null.
 * Resolves the hostname, so it is async and needs working DNS.
 */
export async function checkPublicUrl(raw: string, opts: PublicUrlOptions): Promise<string | null> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'URL tidak valid.'
  }

  if (opts.allowLocalhost && isLocalhostUrl(url) && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return null
  }
  if (url.protocol !== 'https:') return 'Pakai URL https (http hanya boleh ke localhost saat development).'
  if (url.username || url.password) return 'URL tidak boleh berisi username atau password.'

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    return isPrivateAddress(host) ? 'URL menunjuk ke alamat jaringan internal.' : null
  }

  let addresses: LookupAddress[]
  try {
    addresses = await new Promise((resolve, reject) =>
      dnsLookup(host, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
    )
  } catch {
    return `Host ${host} tidak ditemukan.`
  }
  if (addresses.length === 0) return `Host ${host} tidak ditemukan.`
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return `${host} mengarah ke alamat jaringan internal.`
  }
  return null
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * A drop-in for `dns.lookup` that refuses private addresses.
 *
 * Handed to the HTTP client as the connection's resolver, so the address
 * checked is the address dialled - there is no gap for DNS to change its
 * answer in between.
 */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | undefined,
  callback: LookupCallback,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err, [])
    const blocked = addrs.find((a) => isPrivateAddress(a.address))
    if (blocked) {
      const e = new Error(`${hostname} mengarah ke alamat jaringan internal (${blocked.address})`) as NodeJS.ErrnoException
      e.code = 'EPRIVATEADDR'
      return callback(e, [])
    }
    if (addrs.length === 0) {
      const e = new Error(`${hostname} tidak punya alamat`) as NodeJS.ErrnoException
      e.code = 'ENOTFOUND'
      return callback(e, [])
    }
    if (options?.all) return callback(null, addrs)
    return callback(null, addrs[0]!.address, addrs[0]!.family)
  })
}
