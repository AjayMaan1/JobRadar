import { log } from '@jobradar/log'
/** Crawler-level configuration (env-driven). */

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

function buildUserAgent(): string {
  const url = process.env.CONTACT_URL?.trim()
  const email = process.env.CONTACT_EMAIL?.trim()
  const parts: string[] = []
  if (url) parts.push(`+${url}`)
  if (email) parts.push(`mailto:${email}`)
  if (parts.length === 0) {
    if (!(globalThis as any).__jobradarUaWarned) {
      ;(globalThis as any).__jobradarUaWarned = true
      log.warn(
        '[gateway] CONTACT_URL / CONTACT_EMAIL not set — User-Agent has no contact info. Configure them before running at scale.'
      )
    }
    return 'JobRadar/2.0 (personal job-alert tool)'
  }
  return `JobRadar/2.0 (${parts.join('; ')})`
}

export const CRAWLER_CONFIG = {
  userAgent: buildUserAgent(),
  globalMaxRps: parseFloat(env('GATEWAY_GLOBAL_MAX_RPS', '8')),
  defaultTimeoutMs: parseInt(env('GATEWAY_TIMEOUT_MS', '20000'), 10),
  /** Response body caps (audit NEW-27): a board JSON above this is not a board; HTML pages are trimmed. */
  maxBodyBytes: parseInt(env('GATEWAY_MAX_BODY_BYTES', String(8 * 1024 * 1024)), 10),
  maxRedirects: parseInt(env('GATEWAY_MAX_REDIRECTS', '5'), 10),
  robotsTtlSeconds: 24 * 3600,
  hostPolicyCacheSeconds: 60,
  /** How long a host circuit stays open after a block (403/challenge). */
  blockCircuitMs: 6 * 3600 * 1000,
  /** Minimum circuit open time after a 429 (Retry-After may extend it). */
  rateLimitCircuitMinMs: 60 * 1000,
  rateLimitCircuitMaxMs: 6 * 3600 * 1000,
}
