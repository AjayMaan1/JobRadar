import { NextResponse } from 'next/server'
import { withTimeout, m } from '@jobradar/log'
import { services } from './services'

/**
 * Fixed-window rate limit in Redis (backlog C1-5, audit NEW-04). Falls back to an in-memory map when Redis is
 * unreachable so a Redis outage degrades to "per-process limit" rather than "no service".
 *
 * Keys are per user (`user:<id>:<action>`) for authenticated actions and per IP for anonymous ones; IP limits
 * are only as good as `clientIp()` (see TRUSTED_PROXY in lib/auth.ts).
 */
const memory = new Map<string, { n: number; exp: number }>()

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number; retryAfterSec: number }> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec)
  const k = `rl:${key}:${bucket}`
  let res: { ok: boolean; remaining: number; retryAfterSec: number }
  try {
    const { redis } = services()
    const n = await withTimeout(redis.incr(k), 1000, 'rate limit')
    if (n === 1) await withTimeout(redis.expire(k, windowSec), 1000, 'rate limit')
    res = { ok: n <= limit, remaining: Math.max(0, limit - n), retryAfterSec: windowSec - (Math.floor(Date.now() / 1000) % windowSec) }
  } catch {
    const now = Date.now()
    const cur = memory.get(k)
    const e = cur && cur.exp > now ? cur : { n: 0, exp: now + windowSec * 1000 }
    e.n++
    memory.set(k, e)
    if (memory.size > 10_000) for (const [mk, mv] of memory) if (mv.exp < now) memory.delete(mk)
    res = { ok: e.n <= limit, remaining: Math.max(0, limit - e.n), retryAfterSec: Math.ceil((e.exp - now) / 1000) }
  }
  if (!res.ok) m.rateLimited.inc({ action: key.split(':').pop() ?? key })
  return res
}

export function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json({ error: 'Too many requests', retryAfterSec }, { status: 429, headers: { 'retry-after': String(retryAfterSec) } })
}

/**
 * Per-user limits for the expensive actions (uploads, analyses, LLM runs, renders). Generous for a human,
 * tight enough that a script cannot burn the LLM budget or the CPU. Override with RATE_<ACTION>=n/windowSec.
 */
export const LIMITS = {
  upload: env('RATE_UPLOAD', 20, 3600),
  analysis: env('RATE_ANALYSIS', 60, 3600),
  suggest: env('RATE_SUGGEST', 40, 3600),
  render: env('RATE_RENDER', 30, 3600),
  jd: env('RATE_JD', 30, 3600),
  mutate: env('RATE_MUTATE', 600, 3600),
  auth: env('RATE_AUTH', 10, 900),
  export: env('RATE_EXPORT', 5, 3600),
} as const

function env(name: string, limit: number, windowSec: number): { limit: number; windowSec: number } {
  const v = process.env[name]
  if (!v) return { limit, windowSec }
  const [l, w] = v.split('/').map((x) => parseInt(x, 10))
  return { limit: Number.isFinite(l) && l > 0 ? l : limit, windowSec: Number.isFinite(w) && w > 0 ? w : windowSec }
}

/** `const rl = await limitUser(user.id, 'analysis'); if (rl) return rl` */
export async function limitUser(userId: string, action: keyof typeof LIMITS): Promise<NextResponse | null> {
  const { limit, windowSec } = LIMITS[action]
  const r = await rateLimit(`user:${userId}:${action}`, limit, windowSec)
  return r.ok ? null : tooMany(r.retryAfterSec)
}
