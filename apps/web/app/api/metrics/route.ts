import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { metrics, m } from '@jobradar/log'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'
import { services } from '../../../lib/services'

/**
 * Prometheus text exposition for the web tier (audit NEW-06). Scrape with `Authorization: Bearer $METRICS_TOKEN`
 * (or an admin session). The worker exposes its own registry on :9464/metrics.
 */
function tokenOk(req: NextRequest): boolean {
  const expected = process.env.METRICS_TOKEN
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('token')
  if (!expected || !given) return false
  const a = Buffer.from(expected), b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

let wired = false
function wireCollectors() {
  if (wired) return
  wired = true
  m.queueDepth.collect(async () => {
    const { bullQueues, inline } = services()
    if (!bullQueues) { m.queueDepth.set({ queue: 'inline', state: 'waiting' }, inline?.pending.count ?? 0); return }
    for (const q of bullQueues) {
      const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed')
      for (const [state, n] of Object.entries(c)) m.queueDepth.set({ queue: q.name, state }, n)
    }
  })
}

export async function GET(req: NextRequest) {
  if (!tokenOk(req)) { try { await requireAdmin() } catch (err) { return authErrorResponse(err)! } }
  wireCollectors()
  const body = await metrics.expose()
  return new NextResponse(body, { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } })
}
