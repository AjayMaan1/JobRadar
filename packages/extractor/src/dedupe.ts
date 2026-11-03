import type { PrismaClient, Job, Prisma } from '@jobradar/db'
import type { NormalizedJob } from './normalizer.js'

export interface UpsertExtras {
  companyId?: string | null
  employmentType?: 'full_time' | 'contract' | 'part_time' | 'internship' | 'unknown'
  opportunityClass?: 'p1_global_remote' | 'p2_india_remote' | 'p3_ncr_hybrid' | 'none'
  classReason?: string | null
  firstSeenAt?: Date | null
}

export interface UpsertResult {
  job: Job
  created: boolean
  matchedBy: 'url' | 'hash' | 'none'
}

export class DedupeService {
  constructor(private prisma: PrismaClient) {}

  async findExisting(job: NormalizedJob): Promise<{ job: Job; matchedBy: 'url' | 'hash' } | null> {
    if (job.applyUrlNormalized) {
      // v3: match on the stored normalised URL (audit F10); legacy rows without it fall back to raw columns.
      const byNorm = await this.prisma.job.findFirst({ where: { applyUrlNormalized: job.applyUrlNormalized } })
      if (byNorm) return { job: byNorm, matchedBy: 'url' }
      const byUrl = await this.prisma.job.findFirst({ where: { applyUrl: { equals: job.applyUrlNormalized, mode: 'insensitive' } } })
      if (byUrl) return { job: byUrl, matchedBy: 'url' }
      const bySrc = await this.prisma.job.findFirst({ where: { sourceUrl: { equals: job.applyUrlNormalized, mode: 'insensitive' } } })
      if (bySrc) return { job: bySrc, matchedBy: 'url' }
    }
    const byHash = await this.prisma.job.findUnique({ where: { canonicalHash: job.canonicalHash } })
    if (byHash) return { job: byHash, matchedBy: 'hash' }
    return null
  }

  /**
   * URL-normalised match first, canonical hash second. Returns whether the row was created —
   * the single fact the alerting path depends on.
   */
  async upsert(job: NormalizedJob, extras: UpsertExtras = {}): Promise<UpsertResult> {
    const skillsString = Array.isArray(job.skills) ? JSON.stringify(job.skills) : '[]'
    const { applyUrlNormalized, ...rest } = job
    const existing = await this.findExisting(job)
    const now = new Date()

    const common = {
      title: rest.title,
      company: rest.company,
      sourceUrl: rest.sourceUrl,
      applyUrl: rest.applyUrl,
      applyUrlNormalized,
      country: rest.country,
      region: rest.region,
      city: rest.city,
      remoteType: rest.remoteType,
      salaryMin: rest.salaryMin,
      salaryMax: rest.salaryMax,
      salaryCurrency: rest.salaryCurrency,
      salaryPeriod: rest.salaryPeriod,
      salaryConfidence: rest.salaryConfidence,
      salaryInrMin: rest.salaryInrMin,
      salaryInrMax: rest.salaryInrMax,
      salaryUsdMin: rest.salaryUsdMin,
      salaryUsdMax: rest.salaryUsdMax,
      experienceMin: rest.experienceMin,
      experienceMax: rest.experienceMax,
      seniority: rest.seniority,
      category: rest.category,
      eligibility: rest.eligibility,
      eligibilityConfidence: rest.eligibilityConfidence,
      eligibilityEvidence: rest.eligibilityEvidence,
      skills: skillsString,
      postedAt: rest.postedAt,
      sourceFingerprint: rest.sourceFingerprint,
      lastSeenAt: now,
      closedAt: null as Date | null,
      ...(extras.companyId !== undefined ? { companyId: extras.companyId } : {}),
      ...(extras.employmentType ? { employmentType: extras.employmentType } : {}),
      ...(extras.opportunityClass ? { opportunityClass: extras.opportunityClass } : {}),
      ...(extras.classReason !== undefined ? { classReason: extras.classReason } : {}),
    }

    if (existing) {
      // Re-sightings often carry only list-level data (no detail fetch). Never let a sparse payload
      // erase richer fields captured earlier: salary, description, skills, seniority, category, eligibility.
      const old = existing.job
      const keep = <T>(next: T | null | undefined, prev: T | null): T | null => (next === null || next === undefined ? prev : next)
      const hasSalary = rest.salaryMin !== null || rest.salaryMax !== null
      const data: Prisma.JobUncheckedUpdateInput = {
        ...common,
        salaryMin: hasSalary ? rest.salaryMin : old.salaryMin,
        salaryMax: hasSalary ? rest.salaryMax : old.salaryMax,
        salaryCurrency: hasSalary ? rest.salaryCurrency : old.salaryCurrency,
        salaryPeriod: hasSalary ? rest.salaryPeriod : old.salaryPeriod,
        salaryConfidence: hasSalary ? rest.salaryConfidence : old.salaryConfidence,
        salaryInrMin: hasSalary ? rest.salaryInrMin : old.salaryInrMin,
        salaryInrMax: hasSalary ? rest.salaryInrMax : old.salaryInrMax,
        salaryUsdMin: hasSalary ? rest.salaryUsdMin : old.salaryUsdMin,
        salaryUsdMax: hasSalary ? rest.salaryUsdMax : old.salaryUsdMax,
        seniority: keep(rest.seniority, old.seniority),
        category: keep(rest.category, old.category),
        postedAt: keep(rest.postedAt, old.postedAt),
        skills: job.skills.length ? skillsString : old.skills,
        eligibility: rest.eligibility === 'unknown' && old.eligibility !== 'unknown' ? old.eligibility : rest.eligibility,
        eligibilityConfidence: rest.eligibility === 'unknown' && old.eligibility !== 'unknown' ? old.eligibilityConfidence : rest.eligibilityConfidence,
        eligibilityEvidence: rest.eligibility === 'unknown' && old.eligibility !== 'unknown' ? old.eligibilityEvidence : rest.eligibilityEvidence,
        // keep the richer description if the new one is empty/shorter
        ...(rest.description && rest.description.length >= (old.description?.length ?? 0) ? { description: rest.description } : {}),
        // class: a sparse re-sighting must not downgrade a classification made with the full description
        ...(extras.opportunityClass === 'none' && old.opportunityClass !== 'none' && !rest.description ? { opportunityClass: old.opportunityClass, classReason: old.classReason } : {}),
        // lifecycle only (v3): a closed job that reappears is open again; per-user saved/applied state is untouched
        ...(old.status === 'closed' ? { status: 'new' } : {}),
      }
      const updated = await this.prisma.job.update({ where: { id: existing.job.id }, data })
      return { job: updated, created: false, matchedBy: existing.matchedBy }
    }

    const createdJob = await this.prisma.job.create({
      data: {
        ...common,
        sourceName: rest.sourceName,
        sourceType: rest.sourceType,
        description: rest.description,
        canonicalHash: rest.canonicalHash,
        status: 'new',
        rankingScore: 0,
        baseScore: 0,
        firstSeenAt: extras.firstSeenAt ?? now,
        discoveredAt: now,
      },
    })
    return { job: createdJob, created: true, matchedBy: 'none' }
  }
}
