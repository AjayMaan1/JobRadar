import type { Job, PrismaClient } from '@jobradar/db'
import { scoreCompensation } from './scorers/compensation.scorer.js'
import { scoreRoleFit, type RoleFitPrefs } from './scorers/role-fit.scorer.js'
import { RANKING_CONFIG } from './config.js'
import { scoreFreshness } from './scorers/freshness.scorer.js'
import { scoreSourceQuality } from './scorers/source-quality.scorer.js'
import { scoreSalaryTransparency } from './scorers/salary-transparency.scorer.js'
import { scoreClass } from './scorers/class.scorer.js'

export interface ScoreBreakdown {
  classBand: number
  compensation: number
  roleFit: number
  salaryTransparency: number
  sourceQuality: number
  base: number
  freshness: number
  total: number
}

export class RankingService {
  private qualityCache = new Map<string, { at: number; q: number }>()
  private prefsCache: { at: number; prefs: RoleFitPrefs } | null = null

  constructor(private prisma: PrismaClient) {}

  /**
   * Role-fit preferences for the GLOBAL base score. base_score is shared by every user, so a profile may only
   * drive it on a single-user deployment (audit NEW-03: on a multi-user box one user's skills must not reorder
   * everyone's inbox — personal ranking lives in job_fits / matchScore). Cached 10 min.
   */
  async prefs(): Promise<RoleFitPrefs> {
    if (this.prefsCache && Date.now() - this.prefsCache.at < 10 * 60_000) return this.prefsCache.prefs
    let prefs: RoleFitPrefs = RANKING_CONFIG
    try {
      const users = await this.prisma.user.count()
      if (users <= 1) {
        const profile = await this.prisma.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } })
        const skills = ((profile?.skills as Array<{ canonical?: string; name?: string }> | null) ?? []).map((s) => s.canonical ?? s.name ?? '').filter(Boolean)
        if (profile && skills.length) {
          prefs = { targetSkills: skills, preferredCategories: RANKING_CONFIG.preferredCategories, preferredSeniority: RANKING_CONFIG.preferredSeniority, targetTitles: profile.targetTitles }
        }
      }
    } catch { /* table may not exist yet during migration; fall back */ }
    this.prefsCache = { at: Date.now(), prefs }
    return prefs
  }

  /** Base score (stored). Everything except freshness. */
  computeBase(job: Job, quality: number | null, prefs: RoleFitPrefs = RANKING_CONFIG): ScoreBreakdown {
    const classBand = scoreClass(job)
    const compensation = scoreCompensation(job)
    const roleFit = scoreRoleFit(job, prefs)
    const salaryTransparency = scoreSalaryTransparency(job)
    const sourceQuality = scoreSourceQuality(job, quality)
    const base = classBand + compensation + roleFit + salaryTransparency + sourceQuality
    const freshness = scoreFreshness(job)
    return { classBand, compensation, roleFit, salaryTransparency, sourceQuality, base, freshness, total: Math.min(100, base + freshness) }
  }

  /** Display score = base + freshness(now). Use at read time. */
  static displayScore(job: Pick<Job, 'baseScore' | 'firstSeenAt' | 'postedAt' | 'discoveredAt'>, now = Date.now()): number {
    return Math.min(100, Math.max(0, Math.round(job.baseScore + scoreFreshness(job, now))))
  }

  async qualityFor(job: Job): Promise<number | null> {
    const key = job.companyId ? `c:${job.companyId}` : `s:${job.sourceName}`
    const hit = this.qualityCache.get(key)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.q
    let q: number | null = null
    if (job.companyId) {
      const c = await this.prisma.company.findUnique({ where: { id: job.companyId }, select: { qualityScore: true, anchor: true } })
      if (c) q = c.anchor ? Math.max(c.qualityScore, 85) : c.qualityScore || 60
    } else {
      const s = await this.prisma.source.findFirst({ where: { name: job.sourceName }, select: { qualityScore: true } })
      if (s) q = s.qualityScore
    }
    if (q !== null) this.qualityCache.set(key, { at: Date.now(), q })
    return q
  }

  async scoreAndStore(job: Job): Promise<ScoreBreakdown> {
    const [quality, prefs] = await Promise.all([this.qualityFor(job), this.prefs()])
    const b = this.computeBase(job, quality, prefs)
    await this.prisma.job.update({ where: { id: job.id }, data: { baseScore: b.base, rankingScore: b.total } })
    return b
  }

  /** Legacy sync API (no DB lookup): base + freshness with default quality. */
  scoreJob(job: Job): number {
    return this.computeBase(job, null).total
  }

  async rescoreAll(batch = 500): Promise<number> {
    let cursor: string | undefined
    let n = 0
    for (;;) {
      const jobs = await this.prisma.job.findMany({ take: batch, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' } })
      if (jobs.length === 0) break
      for (const job of jobs) {
        await this.scoreAndStore(job)
        n++
      }
      cursor = jobs[jobs.length - 1].id
    }
    return n
  }
}
