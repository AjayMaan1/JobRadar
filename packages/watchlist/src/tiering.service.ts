import type { PrismaClient, Company, PollTier, CompanyStatus, OpportunityClass } from '@jobradar/db'
import { isRelevantRole } from '@jobradar/crawler'
import { isNcrLocation } from '@jobradar/extractor'
import { WATCHLIST_CONFIG, nextPollAtFor } from './config.js'
import { effectiveTier } from './board-poll.service.js'

const CLASS_ORDER: OpportunityClass[] = ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid', 'none']

function bestOf(counts: Record<string, number>): OpportunityClass {
  for (const c of CLASS_ORDER) if ((counts[c] ?? 0) > 0) return c
  return 'none'
}

/**
 * Hourly: recompute per-company aggregates from jobs/sightings/pay evidence, derive status + tier,
 * and pull boards' next_poll_at forward when a company gets hotter. Anchors are exempt from
 * activity-based demotion (but still show in health if they produce nothing).
 */
/** Deployment crawl policy (v5, union of users' preferences). Absent → legacy env behaviour (India owner). */
export interface CrawlPolicy {
  scope(): Promise<{ excludedHqCountries: string[]; floorUsd: number | null; users: number }>
}

export const PREFS_ENGINE = (): 'evals' | 'legacy' => (process.env.PREFS_ENGINE === 'legacy' ? 'legacy' : 'evals')

export class TieringService {
  constructor(private prisma: PrismaClient, private policy: CrawlPolicy | null = null) {}

  async run(batch = 200): Promise<{ companies: number; changed: number }> {
    let cursor: string | undefined
    let n = 0, changed = 0
    for (;;) {
      const companies = await this.prisma.company.findMany({
        where: { status: { in: ['probing', 'watched', 'dormant', 'unresolved', 'discovered'] } },
        take: batch,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      })
      if (companies.length === 0) break
      for (const c of companies) {
        n++
        if (await this.recompute(c)) changed++
      }
      cursor = companies[companies.length - 1].id
    }
    return { companies: n, changed }
  }

  async recompute(c: Company): Promise<boolean> {
    const d180 = new Date(Date.now() - 180 * 86400_000)
    const d90 = new Date(Date.now() - 90 * 86400_000)
    const d30 = new Date(Date.now() - 30 * 86400_000)

    const boards = await this.prisma.companyBoard.findMany({ where: { companyId: c.id } })
    const hasBoard = boards.some((b) => b.enabled && b.status !== 'gone' && b.status !== 'disabled')

    const jobs = await this.prisma.job.findMany({
      where: { companyId: c.id, firstSeenAt: { gte: d180 } },
      select: { opportunityClass: true, firstSeenAt: true, closedAt: true, title: true, category: true, city: true, region: true, country: true, skills: true, employmentType: true },
    })
    const counts: Record<string, number> = {}
    const offices = new Set<string>(c.offices ?? [])
    let eng = 0
    let active = 0
    let rate30 = 0
    let lastPostingAt: Date | null = c.lastPostingAt
    for (const j of jobs) {
      if (!['internship', 'part_time'].includes(String(j.employmentType))) counts[j.opportunityClass] = (counts[j.opportunityClass] ?? 0) + 1
      if (isRelevantRole(j.title)) eng++
      if (!j.closedAt) active++
      if (j.firstSeenAt >= d30) rate30++
      if (!lastPostingAt || j.firstSeenAt > lastPostingAt) lastPostingAt = j.firstSeenAt
      const loc = [j.city, j.region].filter(Boolean).join(', ')
      if (loc && isNcrLocation(loc)) offices.add('Delhi NCR')
    }
    let best = bestOf(counts)
    const policy = this.policy && PREFS_ENGINE() === 'evals' ? await this.policy.scope() : null
    if (policy) {
      // v5: "eligible posting" = any active user's evaluation put it in a tier. Points map onto the legacy
      // best_class column (40+ → p1, 30+ → p2, else p3) so the health page keeps working.
      const evals = await this.prisma.jobUserEval.findMany({ where: { tier: { not: 'none' }, job: { companyId: c.id, firstSeenAt: { gte: d180 }, employmentType: { notIn: ['internship', 'part_time'] } } }, select: { components: true } })
      let pts = 0
      for (const e of evals) pts = Math.max(pts, Number((e.components as { tier?: number } | null)?.tier ?? 0))
      best = !evals.length ? 'none' : pts >= 40 ? 'p1_global_remote' : pts >= 30 ? 'p2_india_remote' : 'p3_ncr_hybrid'
      for (const k of Object.keys(counts)) delete counts[k]
      counts[best] = evals.length
    }
    const activity90 = jobs.some((j) => j.firstSeenAt >= d90)
    const engineeringShare = jobs.length ? eng / jobs.length : 0
    const hq = (c.hqCountry ?? '').toUpperCase()
    const hqExcluded = policy ? policy.excludedHqCountries.includes(hq) : hq === 'IN'
    const belowFloor = policy
      ? policy.floorUsd !== null && c.payMedianInr !== null && c.payMedianInr / 84.5 < policy.floorUsd && c.payConfidence >= WATCHLIST_CONFIG.payFloorConfidence
      : c.payBandStatus === 'below_floor' && c.payConfidence >= WATCHLIST_CONFIG.payFloorConfidence

    // status
    let status: CompanyStatus = c.status
    let statusReason: string | null = c.statusReason
    if (hqExcluded) {
      status = 'dormant'; statusReason = policy ? `hq_excluded:${hq}` : 'india_hq'
    } else if (!hasBoard) {
      status = boards.length ? 'retired' : c.status === 'discovered' ? 'discovered' : 'unresolved'
      statusReason = boards.length ? 'all boards gone/disabled' : statusReason
    } else if (belowFloor && !c.anchor) {
      status = 'dormant'; statusReason = `below pay floor (median ₹${Math.round((c.payMedianInr ?? 0) / 100000)}L, conf ${c.payConfidence.toFixed(2)})`
    } else if (best === 'none' && c.lastProbedAt && Date.now() - c.lastProbedAt.getTime() > 3600_000 && !c.anchor) {
      // only after the probe's enrich payloads have had time to land (≥1h)
      status = 'dormant'; statusReason = policy ? 'no posting matched any user tier in 180d' : 'no P1/P2/P3 postings in 180d'
    } else if (c.lastProbedAt) {
      status = 'watched'; statusReason = null
    }

    // tier
    let tier: PollTier = c.tier
    if (status === 'dormant' || status === 'retired' || status === 'unresolved' || status === 'discovered') tier = 'dormant'
    else if (best === 'p1_global_remote' && rate30 >= 2) tier = 'hot'
    else if (best === 'p1_global_remote' || best === 'p2_india_remote') tier = activity90 ? (rate30 >= 2 ? 'hot' : 'warm') : 'cold'
    else if (best === 'p3_ncr_hybrid') tier = 'warm'
    else tier = 'cold'
    if (c.anchor && (tier === 'dormant' || tier === 'cold') && status !== 'dormant') tier = 'warm'
    if (c.anchor && status === 'dormant' && statusReason !== 'india_hq' && !statusReason?.startsWith('hq_excluded') && !statusReason?.startsWith('below pay floor')) {
      status = 'watched'; statusReason = best === 'none' ? 'anchor: 0 eligible postings in 180d' : null
      tier = 'warm'
    }

    const tierReason = `best=${best} rate30=${rate30} active90=${activity90} pay=${c.payBandStatus}${c.anchor ? ' anchor' : ''}`
    const changed = status !== c.status || tier !== c.tier || best !== c.bestClass
    await this.prisma.company.update({
      where: { id: c.id },
      data: {
        bestClass: best,
        classCounts180d: counts,
        offices: [...offices],
        engineeringShare,
        postingRate30d: rate30,
        activePostings: active,
        lastPostingAt,
        status,
        statusReason,
        tier,
        tierReason,
        tierUpdatedAt: tier !== c.tier ? new Date() : c.tierUpdatedAt,
        qualityScore: Math.max(c.qualityScore, c.anchor ? 85 : best === 'p1_global_remote' ? 75 : best === 'p2_india_remote' ? 70 : 60),
        firstQualifiedAt: c.firstQualifiedAt ?? (status === 'watched' ? new Date() : null),
      },
    })

    // pull boards forward if the company got hotter
    if (changed) {
      const eff = effectiveTier({ tier, manualTier: c.manualTier, anchor: c.anchor })
      for (const b of boards) {
        const next = nextPollAtFor(eff, b.costClass, b.lastPostingCount, b.id)
        if (next < b.nextPollAt || status === 'dormant') {
          await this.prisma.companyBoard.update({ where: { id: b.id }, data: { nextPollAt: next } })
        }
      }
    }
    return changed
  }
}

