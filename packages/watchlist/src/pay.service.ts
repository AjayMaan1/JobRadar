import type { PrismaClient, Job } from '@jobradar/db'
import { WATCHLIST_CONFIG } from './config.js'

const SOURCE_WEIGHT: Record<string, number> = {
  own_posting: 1.0,
  manual: 1.0,
  levels_manual: 0.9,
  hn_post: 0.7,
  lca_dataset: 0.5,
  leetcode_comp: 0.6,
}

export class PayService {
  constructor(private prisma: PrismaClient) {}

  /** Record salary from a company's own posting (idempotent per job). */
  async recordFromJob(companyId: string, job: Job): Promise<void> {
    if (!job.salaryInrMin && !job.salaryInrMax) return
    const exists = await this.prisma.payEvidence.findFirst({ where: { companyId, jobId: job.id, source: 'own_posting' } })
    if (exists) return
    await this.prisma.payEvidence.create({
      data: {
        companyId,
        source: 'own_posting',
        jobId: job.id,
        roleTitle: job.title,
        level: job.seniority,
        locationText: [job.city, job.region, job.country].filter(Boolean).join(', ') || null,
        country: job.country,
        minAmount: job.salaryMin,
        maxAmount: job.salaryMax,
        currency: job.salaryCurrency,
        period: job.salaryPeriod,
        inrAnnualMin: job.salaryInrMin,
        inrAnnualMax: job.salaryInrMax,
        confidence: job.salaryConfidence ?? 0.8,
        observedAt: job.postedAt ?? job.firstSeenAt,
        url: job.applyUrl,
      },
    })
  }

  /** Recompute company pay band from evidence (recency-weighted median of INR annual midpoints). */
  async recomputeBand(companyId: string): Promise<void> {
    const since = new Date(Date.now() - 365 * 86400_000)
    const rows = await this.prisma.payEvidence.findMany({ where: { companyId, observedAt: { gte: since } }, orderBy: { observedAt: 'desc' } })
    if (rows.length === 0) {
      await this.prisma.company.update({ where: { id: companyId }, data: { payBandStatus: 'unknown', payConfidence: 0, payEvidenceCount: 0 } })
      return
    }
    const points: Array<{ mid: number; w: number; min: number; max: number }> = []
    for (const r of rows) {
      const lo = r.inrAnnualMin ?? r.inrAnnualMax
      const hi = r.inrAnnualMax ?? r.inrAnnualMin
      if (!lo && !hi) continue
      const ageDays = (Date.now() - r.observedAt.getTime()) / 86400_000
      const recency = ageDays < 90 ? 1 : ageDays < 180 ? 0.8 : 0.6
      points.push({ mid: ((lo ?? 0) + (hi ?? 0)) / 2, w: (SOURCE_WEIGHT[r.source] ?? 0.5) * r.confidence * recency, min: lo ?? 0, max: hi ?? 0 })
    }
    if (points.length === 0) return
    points.sort((a, b) => a.mid - b.mid)
    const totalW = points.reduce((s, p) => s + p.w, 0)
    let acc = 0
    let median = points[points.length - 1].mid
    for (const p of points) {
      acc += p.w
      if (acc >= totalW / 2) {
        median = p.mid
        break
      }
    }
    const confidence = Math.min(1, (points.length >= 3 ? 0.6 : points.length * 0.2) + (points.some((p) => p.w >= 0.8) ? 0.2 : 0))
    const status = confidence >= WATCHLIST_CONFIG.payFloorConfidence
      ? median < WATCHLIST_CONFIG.payFloorInr ? 'below_floor' : 'above_floor'
      : 'unknown'
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        payMinInr: Math.min(...points.map((p) => p.min || p.mid)),
        payMaxInr: Math.max(...points.map((p) => p.max || p.mid)),
        payMedianInr: median,
        payConfidence: confidence,
        payEvidenceCount: points.length,
        payLastAt: rows[0].observedAt,
        payBandStatus: status,
      },
    })
  }
}
