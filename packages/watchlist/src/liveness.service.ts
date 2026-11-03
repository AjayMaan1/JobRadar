import type { PrismaClient } from '@jobradar/db'
import type { FetchGateway } from '@jobradar/crawler'
import { WATCHLIST_CONFIG } from './config.js'
import { SightingService } from './sighting.service.js'
import { log } from '@jobradar/log'

const CLOSED_MARKERS = [
  /job (is )?no longer (available|active|accepting)/i,
  /this (job|position|posting|role) (has been )?(closed|filled|removed|expired)/i,
  /position (has been )?filled/i,
  /posting (has )?expired/i,
  /sorry, this job (is|has)/i,
  /job not found/i,
  /the job you are looking for/i,
  /opening (is )?closed/i,
]

/**
 * Closure ladder for jobs that only have aggregator (windowed) sightings:
 *  1. matched to a watched board → board sightings are authoritative (nothing to do here)
 *  2. age > 14d → budgeted GET on the apply URL: 404/410, redirect to board root, or "no longer available" → close
 *  3. no re-sighting for 60d → age out
 */
export class LivenessService {
  private sightings: SightingService
  constructor(private prisma: PrismaClient, private gateway: FetchGateway) {
    this.sightings = new SightingService(prisma)
  }

  async run(): Promise<{ checked: number; closed: number; agedOut: number }> {
    const now = Date.now()
    const minAge = new Date(now - WATCHLIST_CONFIG.livenessMinAgeDays * 86400_000)
    const recheck = new Date(now - WATCHLIST_CONFIG.livenessRecheckDays * 86400_000)
    const ageOut = new Date(now - WATCHLIST_CONFIG.livenessAgeOutDays * 86400_000)

    // 3. age-out first (cheap, no network)
    const aged = await this.prisma.job.updateMany({
      where: { closedAt: null, status: 'new', lastSeenAt: { lt: ageOut }, sightings: { none: { boardId: { not: null } } } },
      data: { closedAt: new Date(), status: 'closed' },
    })

    // 2. liveness checks, budgeted
    const candidates = await this.prisma.job.findMany({
      where: {
        closedAt: null,
        status: 'new',
        firstSeenAt: { lt: minAge },
        OR: [{ livenessCheckedAt: null }, { livenessCheckedAt: { lt: recheck } }],
        sightings: { none: { boardId: { not: null }, goneAt: null } },
        applyUrl: { not: null },
      },
      orderBy: [{ status: 'desc' }, { livenessCheckedAt: 'asc' }],
      take: WATCHLIST_CONFIG.livenessDailyBudget,
    })
    let checked = 0, closed = 0
    for (const job of candidates) {
      const url = job.applyUrl!
      let dead = false
      try {
        const res = await this.gateway.fetch({ url, purpose: 'liveness', kind: 'html', headers: { Accept: 'text/html' }, manualRedirect: true, timeoutMs: 15000 })
        if (res.outcome === 'skipped') continue // budget / circuit — try again tomorrow
        checked++
        if (res.outcome === 'not_found') dead = true
        else if (res.redirectLocation) {
          try {
            const to = new URL(res.redirectLocation, url)
            const from = new URL(url)
            // redirect to the board root / careers home (path much shorter) → posting gone
            if (to.pathname.split('/').filter(Boolean).length <= 1 && from.pathname.split('/').filter(Boolean).length >= 2) dead = true
          } catch { /* ignore */ }
        } else if (res.outcome === 'changed' && res.body) {
          if (CLOSED_MARKERS.some((m) => m.test(res.body!.slice(0, 50_000)))) dead = true
        }
      } catch (err) {
        log.warn('[liveness] check failed', url, (err as Error).message)
      }
      await this.prisma.job.update({
        where: { id: job.id },
        data: dead
          ? { livenessCheckedAt: new Date(), closedAt: new Date(), status: 'closed' }
          : { livenessCheckedAt: new Date() },
      })
      if (dead) closed++
    }
    return { checked, closed, agedOut: aged.count }
  }
}
