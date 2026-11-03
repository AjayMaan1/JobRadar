import type { PrismaClient, Job } from '@jobradar/db'
import type Redis from 'ioredis'
import { engineFor, isRelevantRole, candidateFromApplyUrl, type FetchGateway, type BoardRef } from '@jobradar/crawler'
import { ExtractorService } from '@jobradar/extractor'
import { RankingService } from '@jobradar/ranking'
import { NotificationService } from '@jobradar/notifications'
import { SightingService } from './sighting.service.js'
import { CompanyService } from './company.service.js'
import { PayService } from './pay.service.js'
import { DiscoveryService } from './discovery.service.js'
import type { EnrichPayload } from './types.js'
import { log } from '@jobradar/log'
import { PREFS_ENGINE } from './tiering.service.js'

export interface EnrichOutcome {
  status: 'irrelevant' | 'failed' | 'created' | 'updated'
  jobId?: string
  /** Legacy owner-centric class (compat); per-user tiers are in `evals`. */
  opportunityClass?: string
  alert?: 'sent' | 'deferred' | 'skipped' | 'failed' | 'not_applicable'
  /** v5: per-user evaluation results (userId → tier/score). Empty when PREFS_ENGINE=legacy or no active users. */
  evals?: Map<string, UserEval>
}

export interface UserEval { tier: string; score: number; eligible: boolean; instant: boolean; label?: string | null; reasons?: string[] }

/** v5 hook implemented by @jobradar/prefs EvalService (kept as an interface so watchlist does not depend on it). */
export interface JobEvaluator {
  evaluateJob(job: Job): Promise<Map<string, { tier: string; score: number; eligible: boolean; tierLabel?: string | null; reasons?: string[] }>>
  /** Tier ids flagged "instant" per user (for alert fan-out). */
  instantTiers(userId: string): Promise<Set<string>>
  /** The deployment owner — the env-configured alert channel is theirs. */
  ownerUserId(): Promise<string | null>
}

/**
 * new sighting → (detail fetch once) → extract → classify → dedupe/upsert → link sighting →
 * pay evidence → score → alert (P1/P2, created only, capped per feed).
 */
export class EnrichService {
  private extractor: ExtractorService
  private ranking: RankingService
  private notifications: NotificationService
  private sightings: SightingService
  private companies: CompanyService
  private pay: PayService
  private discovery: DiscoveryService

  constructor(private prisma: PrismaClient, redis: Redis, private gateway: FetchGateway, private evaluator: JobEvaluator | null = null) {
    this.extractor = new ExtractorService(prisma, redis)
    this.ranking = new RankingService(prisma)
    this.notifications = new NotificationService(prisma, redis)
    this.sightings = new SightingService(prisma)
    this.companies = new CompanyService(prisma)
    this.pay = new PayService(prisma)
    this.discovery = new DiscoveryService(prisma)
  }

  async enrich(p: EnrichPayload): Promise<EnrichOutcome> {
    const raw = { ...p.raw }

    // 1. cheap relevance pre-filter (title + tags + whatever description we already have)
    if (!isRelevantRole(raw.title, raw.tags ?? [], raw.description ?? '')) {
      return { status: 'irrelevant' }
    }

    // 2. company context
    let company = p.companyId
      ? await this.prisma.company.findUnique({ where: { id: p.companyId } })
      : await this.companies.findByNameOrDomain(raw.company, null)

    // 3. detail fetch, once per sighting, only for board items lacking a description
    let detailFetched = false
    if (p.boardId && p.item && (!raw.description || raw.description.length < 80)) {
      const sighting = await this.prisma.jobSighting.findUnique({ where: { feedKey_externalId: { feedKey: p.feedKey, externalId: p.externalId } } })
      const board = await this.prisma.companyBoard.findUnique({ where: { id: p.boardId } })
      const engine = board ? engineFor(board.atsType) : null
      if (board && engine?.detail && !sighting?.detailFetchedAt) {
        const ref: BoardRef = { id: board.id, atsType: board.atsType, slug: board.slug, apiUrl: board.apiUrl, careersUrl: board.careersUrl, queryScope: board.queryScope as any, companyName: company?.name ?? raw.company }
        try {
          const d = await engine.detail(ref, p.item, this.gateway)
          if (d) {
            raw.description = d.description || raw.description
            if (d.salaryHint && !raw.salary) raw.salary = d.salaryHint
            if (d.employmentTypeHint) p.employmentTypeHints = [...(p.employmentTypeHints ?? []), d.employmentTypeHint]
            detailFetched = true
          }
        } catch (err) {
          log.warn('[enrich] detail fetch failed', p.feedKey, p.externalId, (err as Error).message)
        }
      }
    }

    // 4. extract + classify + upsert
    const sourceName = raw.sourceName
    const sourceType = p.boardId ? 'company_board' : (await this.sourceType(p.sourceId)) ?? 'job_board'
    const result = await this.extractor.processRawJob(raw, { name: sourceName, sourceType }, {
      company: company ? { id: company.id, hqCountry: company.hqCountry, tags: company.tags } : null,
      isRemoteFlag: p.isRemoteFlag ?? null,
      employmentTypeHints: p.employmentTypeHints ?? [],
      firstSeenAt: p.firstSeenAt ? new Date(p.firstSeenAt) : null,
    })
    if (!result) return { status: 'failed' }
    const job: Job = result.job

    // 5. link sighting → job; keep first_seen_at = earliest sighting
    await this.sightings.linkJob(p.feedKey, p.externalId, job.id, detailFetched)

    // 6. company-side effects
    if (company) {
      await this.pay.recordFromJob(company.id, job)
      if (job.salaryInrMin || job.salaryInrMax) await this.pay.recomputeBand(company.id)
      if (!job.companyId) await this.prisma.job.update({ where: { id: job.id }, data: { companyId: company.id } })
    }

    // 7. discovery from aggregator apply URLs (free)
    if (p.sourceId) {
      const cand = candidateFromApplyUrl(raw.company, raw.applyUrl, raw.sourceUrl)
      if (cand) await this.discovery.record(cand)
    }

    // 8. score
    const fresh = await this.prisma.job.findUnique({ where: { id: job.id } })
    if (!fresh) return { status: 'failed' }
    const breakdown = await this.ranking.scoreAndStore(fresh)

    // 8b. v5: per-user evaluation (tier / score / eligibility from the user's own preferences)
    let evals: Map<string, UserEval> | undefined
    if (this.evaluator && PREFS_ENGINE() === 'evals') {
      try {
        const raw = await this.evaluator.evaluateJob(fresh)
        evals = new Map()
        for (const [userId, e] of raw) evals.set(userId, { tier: e.tier, score: e.score, eligible: e.eligible, label: e.tierLabel ?? null, reasons: e.reasons ?? [], instant: e.tier !== 'none' && (await this.evaluator.instantTiers(userId)).has(e.tier) })
      } catch (err) {
        log.error('[enrich] per-user evaluation failed', err as Error, { jobId: job.id })
      }
    }

    // 9. alert — created only, never internships/part-time, never during probes.
    //    v5: per recipient, using that user's evaluation; legacy: owner-centric instant classes.
    let alert: EnrichOutcome['alert'] = 'not_applicable'
    const okType = !['internship', 'part_time'].includes(result.employmentType)
    if (result.created && okType && !p.suppressAlerts && !fresh.closedAt) {
      if (evals) {
        if ([...evals.values()].some((e) => e.instant)) alert = await this.notifications.sendInstantAlert(fresh, { feedKey: p.feedKey, score: breakdown.total, evals, ownerUserId: await this.evaluator!.ownerUserId() })
        else alert = 'skipped'
      } else if (NotificationService.isInstantClass(result.opportunityClass)) {
        alert = await this.notifications.sendInstantAlert(fresh, { feedKey: p.feedKey, score: breakdown.total })
      }
    }

    return { status: result.created ? 'created' : 'updated', jobId: job.id, opportunityClass: result.opportunityClass, alert, evals }
  }

  private async sourceType(sourceId: string | null | undefined): Promise<string | null> {
    if (!sourceId) return null
    const s = await this.prisma.source.findUnique({ where: { id: sourceId }, select: { sourceType: true } })
    return s?.sourceType ?? null
  }
}
