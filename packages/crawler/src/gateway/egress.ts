import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Egress guard (audit v4 recheck, NEW-27): every URL the worker fetches came from somewhere untrusted —
 * aggregator feeds, HN comments, GitHub lists, careers pages, operator input. Without this, a crafted apply URL
 * could point the crawler at Ollama (:11434), Redis, the worker's own metrics port, or a cloud metadata service.
 *
 * Rules: http(s) only · no localhost/.local/.internal names · no loopback, link-local, private, CGNAT, ULA or
 * metadata addresses (literal or resolved) · redirects are re-checked hop by hop by the gateway.
 * DNS failures are NOT treated as private (the fetch will fail on its own); a resolution that includes any
 * private address is rejected (defeats the "one public + one private A record" rebinding trick).
 */
export class EgressBlockedError extends Error {
  constructor(readonly url: string, reason: string) {
    super(`egress blocked: ${reason}`)
    this.name = 'EgressBlockedError'
  }
}

const BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|ip6-localhost|metadata\.google\.internal)$/i

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map((x) => parseInt(x, 10))
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true                 // link-local + cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true      // CGNAT 100.64/10
    if (a === 198 && (b === 18 || b === 19)) return true   // benchmarking
    if (a >= 224) return true                               // multicast / reserved / broadcast
    return false
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    if (s.startsWith('fe80:') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true // link-local fe80::/10
    if (s.startsWith('fc') || s.startsWith('fd')) return true  // unique local fc00::/7
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7)) // v4-mapped
    if (s.startsWith('64:ff9b:')) return false                  // NAT64 public
    if (s.startsWith('2001:db8')) return true                   // documentation
    return false
  }
  return true // not an IP at all → caller resolves names first
}

const cache = new Map<string, { ok: boolean; reason?: string; exp: number }>()
const CACHE_MS = 5 * 60_000

export interface EgressOptions {
  /** Escape hatch for local fixtures / dev (EGRESS_ALLOW_PRIVATE=1). Never set in production. */
  allowPrivate?: boolean
  resolver?: (host: string) => Promise<Array<{ address: string }>>
}

/** Throws EgressBlockedError when the URL must not be fetched. */
export async function assertPublicUrl(raw: string, opts: EgressOptions = {}): Promise<void> {
  let url: URL
  try { url = new URL(raw) } catch { throw new EgressBlockedError(raw, 'invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressBlockedError(raw, `scheme ${url.protocol} not allowed`)
  if (url.username || url.password) throw new EgressBlockedError(raw, 'credentials in URL')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) throw new EgressBlockedError(raw, 'empty host')
  if (opts.allowPrivate ?? process.env.EGRESS_ALLOW_PRIVATE === '1') return
  if (BLOCKED_HOST.test(host)) throw new EgressBlockedError(raw, `host ${host} is internal`)
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new EgressBlockedError(raw, `address ${host} is private`)
    return
  }
  const cached = cache.get(host)
  if (cached && cached.exp > Date.now()) { if (!cached.ok) throw new EgressBlockedError(raw, cached.reason!); return }
  let addrs: Array<{ address: string }> = []
  try {
    addrs = await (opts.resolver ?? ((h: string) => lookup(h, { all: true })))(host)
  } catch {
    return // unresolvable: let fetch fail naturally (and the sandbox's fake fetch answer)
  }
  const bad = addrs.find((a) => isPrivateIp(a.address))
  if (bad) {
    cache.set(host, { ok: false, reason: `${host} resolves to private address ${bad.address}`, exp: Date.now() + CACHE_MS })
    throw new EgressBlockedError(raw, `${host} resolves to private address ${bad.address}`)
  }
  cache.set(host, { ok: true, exp: Date.now() + CACHE_MS })
}

/** Read a response body with a hard byte cap; aborts the stream when exceeded. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const len = parseInt(res.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(len) && len > maxBytes) { try { await res.body?.cancel() } catch { /* ignore */ } return { text: '', truncated: true } }
  if (!res.body) return { text: await res.text(), truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { try { await reader.cancel() } catch { /* ignore */ } return { text: Buffer.concat(chunks).toString('utf8'), truncated: true } }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false }
}

export function _resetEgressCache(): void { cache.clear() }
