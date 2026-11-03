import type { PrismaClient } from '@jobradar/db'

/** Metrics + ops alert conditions (evaluated every few minutes by the maintenance worker). */
export class HealthService {
  constructor(private prisma: PrismaClient) {}

  async hostStats(windowMinutes = 15) {
    const since = new Date(Date.now() - windowMinutes * 60_000)
    const rows = await this.prisma.fetchRun.groupBy({ by: ['host', 'outcome'], where: { startedAt: { gte: since } }, _count: { _all: true } })
    const byHost: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      byHost[r.host] ??= {}
      byHost[r.host][r.outcome] = r._count._all
    }
    return Object.entries(byHost).map(([host, o]) => {
      const total = Object.values(o).reduce((a, b) => a + b, 0)
      return { host, total, rateLimited: o.rate_limited ?? 0, blocked: o.blocked ?? 0, errors: o.error ?? 0, timeouts: o.timeout ?? 0, unchanged: o.unchanged ?? 0, changed: o.changed ?? 0, rateLimitedPct: total ? ((o.rate_limited ?? 0) / total) * 100 : 0 }
    })
  }

  async alerts(): Promise<string[]> {
    const out: string[] = []
    const stats = await this.hostStats(15)
    for (const s of stats) {
      if (s.blocked > 0) out.push(`BLOCKED responses from ${s.host}: ${s.blocked} in 15m`)
      if (s.total >= 20 && s.rateLimitedPct > 1) out.push(`429 rate ${s.rateLimitedPct.toFixed(1)}% on ${s.host}`)
    }
    const blockedBoards = await this.prisma.companyBoard.count({ where: { status: 'blocked' } })
    if (blockedBoards) out.push(`${blockedBoards} board(s) in BLOCKED state need review`)
    const open = await this.prisma.hostPolicy.findMany({ where: { circuitState: 'open', circuitOpenUntil: { gt: new Date() } }, select: { host: true, circuitOpenUntil: true } })
    for (const h of open) out.push(`circuit open: ${h.host} until ${h.circuitOpenUntil?.toISOString()}`)
    const sixHoursAgo = new Date(Date.now() - 6 * 3600_000)
    const hotBoards = await this.prisma.companyBoard.count({ where: { enabled: true, status: 'active', company: { OR: [{ tier: 'hot' }, { manualTier: 'hot' }] } } })
    if (hotBoards > 0) {
      const recentNew = await this.prisma.jobSighting.count({ where: { firstSeenAt: { gte: sixHoursAgo }, boardId: { not: null } } })
      if (recentNew === 0) out.push(`zero new sightings across ${hotBoards} hot boards in 6h`)
    }
    return out
  }

  async timeToDetect(days = 7): Promise<{ medianMinutes: number | null; samples: number }> {
    const since = new Date(Date.now() - days * 86400_000)
    const rows = await this.prisma.jobSighting.findMany({
      where: { firstSeenAt: { gte: since }, postedAtSrc: { not: null }, boardId: { not: null } },
      select: { firstSeenAt: true, postedAtSrc: true },
      take: 5000,
    })
    const deltas = rows.map((r) => (r.firstSeenAt.getTime() - r.postedAtSrc!.getTime()) / 60_000).filter((d) => d >= 0 && d < 60 * 24 * 30).sort((a, b) => a - b)
    if (!deltas.length) return { medianMinutes: null, samples: 0 }
    return { medianMinutes: deltas[Math.floor(deltas.length / 2)], samples: deltas.length }
  }
}
