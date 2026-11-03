import type { Job, Prisma, PrismaClient } from '@jobradar/db'
import { extractJobFacts, type JobFacts } from '@jobradar/extractor'
import { log } from '@jobradar/log'
import { EVALUATOR_VERSION, evaluate, type EvalResult } from '../evaluate.js'
import { parsePreferences, type Preferences } from '../schema.js'

export interface ActiveUserPrefs { userId: string; prefs: Preferences; version: number }

/**
 * Per-user evaluations (HLD §6–7): for every new/updated job × active user, and for every user × open job
 * when their preferences change. Rows in job_user_evals are what the feed, alerts and digest read.
 */
export class EvalService {
  private usersCache: { at: number; users: ActiveUserPrefs[] } | null = null
  private qualityCache = new Map<string, { at: number; q: number | null }>()

  constructor(private prisma: PrismaClient, private opts: { activeDays?: number; userCacheMs?: number } = {}) {}

  /** Users with a preference doc who signed in within `activeDays` (fan-out cap, decision 3). */
  async activeUsers(force = false): Promise<ActiveUserPrefs[]> {
    if (!force && this.usersCache && Date.now() - this.usersCache.at < (this.opts.userCacheMs ?? 60_000)) return this.usersCache.users
    const since = new Date(Date.now() - (this.opts.activeDays ?? 90) * 86400_000)
    const rows = await this.prisma.userPreferences.findMany({ where: { user: { OR: [{ lastLoginAt: { gte: since } }, { lastLoginAt: null, createdAt: { gte: since } }] } }, select: { userId: true, doc: true, version: true } })
    const users: ActiveUserPrefs[] = []
    for (const r of rows) {
      try { users.push({ userId: r.userId, prefs: parsePreferences(r.doc), version: r.version }) } catch (err) { log.warn('invalid preference doc skipped', { userId: r.userId, reason: (err as Error).message }) }
    }
    this.usersCache = { at: Date.now(), users }
    return users
  }

  invalidateUsers(): void { this.usersCache = null }

  private async qualityFor(job: Pick<Job, 'companyId' | 'sourceName'>): Promise<number | null> {
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
    this.qualityCache.set(key, { at: Date.now(), q })
    return q
  }

  /**
   * Facts for a job: the stored row, else derived from the job row (pre-v5 jobs have no raw location; city /
   * region / country + description + eligibility evidence are enough for a usable approximation) and stored.
   */
  async factsFor(job: Job & { facts?: { facts: unknown } | null }): Promise<JobFacts> {
    if (job.facts?.facts) return job.facts.facts as JobFacts
    const row = await this.prisma.jobFacts.findUnique({ where: { jobId: job.id } })
    if (row) return row.facts as unknown as JobFacts
    const company = job.companyId ? await this.prisma.company.findUnique({ where: { id: job.companyId }, select: { hqCountry: true, tags: true } }) : null
    let skills: string[] = []
    try { skills = JSON.parse(job.skills) } catch { /* legacy comma list */ skills = job.skills.split(',').map((s) => s.trim()).filter(Boolean) }
    const facts = extractJobFacts({
      title: job.title,
      location: [job.city, job.region, job.country].filter(Boolean).join(', ') + (job.remoteType === 'remote' ? ' (Remote)' : ''),
      description: `${job.eligibilityEvidence ?? ''}\n${job.description ?? ''}`,
      remoteType: job.remoteType as JobFacts['workMode'],
      employmentType: job.employmentType as JobFacts['employmentType'],
      seniority: job.seniority,
      category: job.category,
      skills,
      salary: job.salaryMin !== null && job.salaryMax !== null && job.salaryCurrency ? { min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: (job.salaryPeriod as 'year' | 'month' | 'hour' | null) ?? 'year' } : null,
      company: company ? { hqCountry: company.hqCountry, tags: company.tags } : null,
    })
    await this.prisma.jobFacts.upsert({ where: { jobId: job.id }, create: { jobId: job.id, facts: facts as unknown as Prisma.InputJsonValue, version: `${facts.version}+backfill` }, update: {} }).catch(() => undefined)
    return facts
  }

  /** Evaluate one job for the given users (default: all active). Returns the evals keyed by user. */
  async evaluateJob(job: Job, users?: ActiveUserPrefs[]): Promise<Map<string, EvalResult>> {
    const targets = users ?? (await this.activeUsers())
    const out = new Map<string, EvalResult>()
    if (!targets.length) return out
    const [facts, quality] = await Promise.all([this.factsFor(job), this.qualityFor(job)])
    for (const u of targets) {
      const r = evaluate({ title: job.title, company: job.company, quality, facts }, u.prefs)
      out.set(u.userId, r)
      await this.prisma.jobUserEval.upsert({
        where: { userId_jobId: { userId: u.userId, jobId: job.id } },
        create: { userId: u.userId, jobId: job.id, tier: r.tier, eligible: r.eligible, score: r.score, reasons: r.reasons as unknown as Prisma.InputJsonValue, components: r.components as unknown as Prisma.InputJsonValue, prefsVersion: u.version, evaluatorVersion: EVALUATOR_VERSION },
        update: { tier: r.tier, eligible: r.eligible, score: r.score, reasons: r.reasons as unknown as Prisma.InputJsonValue, components: r.components as unknown as Prisma.InputJsonValue, prefsVersion: u.version, evaluatorVersion: EVALUATOR_VERSION },
      })
    }
    return out
  }

  /**
   * Re-evaluate one user's open jobs after a preference change. Idempotent per version: rows already at
   * `version` are skipped, so a retried/duplicate run finishes quickly and a newer version wins.
   */
  async reevaluateUser(userId: string, version: number, opts: { batch?: number; onProgress?: (done: number, total: number) => Promise<void> | void } = {}): Promise<{ evaluated: number; skipped: boolean }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } })
    if (!row || row.version !== version) return { evaluated: 0, skipped: true } // superseded
    const user: ActiveUserPrefs = { userId, prefs: parsePreferences(row.doc), version }
    const batch = opts.batch ?? 500
    const total = await this.prisma.job.count({ where: { status: 'new', closedAt: null } })
    let cursor: string | undefined
    let n = 0
    for (;;) {
      const jobs = await this.prisma.job.findMany({ where: { status: 'new', closedAt: null }, take: batch, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' }, include: { facts: true, evals: { where: { userId }, select: { prefsVersion: true, evaluatorVersion: true } } } })
      if (!jobs.length) break
      for (const j of jobs) {
        const cur = j.evals[0]
        if (cur && cur.prefsVersion === version && cur.evaluatorVersion === EVALUATOR_VERSION) continue
        await this.evaluateJob(j, [user])
        n++
      }
      cursor = jobs[jobs.length - 1].id
      await opts.onProgress?.(Math.min(total, n), total)
      // a newer version cancels this run
      const latest = await this.prisma.userPreferences.findUnique({ where: { userId }, select: { version: true } })
      if (!latest || latest.version !== version) return { evaluated: n, skipped: true }
    }
    return { evaluated: n, skipped: false }
  }

  /** Dry run for the editor: tier counts + examples over a recent sample, without writing anything. */
  async preview(doc: unknown, sample = 2000): Promise<{ sample: number; counts: Record<string, number>; excluded: Record<string, number>; examples: Record<string, Array<{ id: string; title: string; company: string; reasons: string[] }>> }> {
    const prefs = parsePreferences(doc)
    const jobs = await this.prisma.job.findMany({ where: { status: 'new', closedAt: null }, orderBy: { firstSeenAt: 'desc' }, take: sample, include: { facts: true } })
    const counts: Record<string, number> = {}
    const excluded: Record<string, number> = {}
    const examples: Record<string, Array<{ id: string; title: string; company: string; reasons: string[] }>> = {}
    for (const j of jobs) {
      const facts = j.facts?.facts ? (j.facts.facts as unknown as JobFacts) : await this.factsFor(j)
      const r = evaluate({ title: j.title, company: j.company, quality: null, facts }, prefs)
      if (r.excluded) { const k = r.excluded.split(' (')[0]; excluded[k] = (excluded[k] ?? 0) + 1 }
      counts[r.tier] = (counts[r.tier] ?? 0) + 1
      if ((examples[r.tier] ??= []).length < 5) examples[r.tier].push({ id: j.id, title: j.title, company: j.company, reasons: r.reasons })
    }
    return { sample: jobs.length, counts, excluded, examples }
  }
}
