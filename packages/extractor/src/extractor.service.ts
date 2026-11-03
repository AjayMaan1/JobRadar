import type Redis from 'ioredis'
import type { PrismaClient, Job, Prisma } from '@jobradar/db'
import type { RawJob } from '@jobradar/crawler'
import { deterministicExtract } from './deterministic.js'
import { llmExtract } from './llm-extractor.js'
import { normalizeJob, type NormalizeSource } from './normalizer.js'
import { DedupeService, type UpsertResult } from './dedupe.js'
import { classifyOpportunity, detectEmploymentType, type ClassifierCompany } from './classifier.js'
import { extractJobFacts, type JobFacts } from './geo/facts.js'
import { log } from '@jobradar/log'

export interface ProcessContext {
  /** Company row (hq, tags) when known — drives P1/P2/P3 classification. */
  company?: (ClassifierCompany & { id: string }) | null
  isRemoteFlag?: boolean | null
  employmentTypeHints?: Array<string | null | undefined>
  firstSeenAt?: Date | null
}

export interface ProcessResult extends UpsertResult {
  /** Legacy owner-centric class (kept one release for compatibility; the feed reads job_user_evals). */
  opportunityClass: 'p1_global_remote' | 'p2_india_remote' | 'p3_ncr_hybrid' | 'none'
  classReason: string
  employmentType: 'full_time' | 'contract' | 'part_time' | 'internship' | 'unknown'
  /** v5: global facts stored on job_facts; the per-user evaluator runs on these. */
  facts: JobFacts
}

export class ExtractorService {
  private dedupe: DedupeService

  constructor(
    private prisma: PrismaClient,
    private redis: Redis
  ) {
    this.dedupe = new DedupeService(prisma)
  }

  async processRawJob(raw: RawJob, source: NormalizeSource, ctx: ProcessContext = {}): Promise<ProcessResult | null> {
    try {
      let extracted = deterministicExtract(raw)
      if (!extracted) extracted = await this.llmExtractTracked(raw)
      if (!extracted) return null

      const normalized = normalizeJob(extracted, source)
      const cls = classifyOpportunity({
        title: extracted.title,
        location: extracted.location,
        description: extracted.description,
        remoteType: extracted.remoteType,
        isRemoteFlag: ctx.isRemoteFlag ?? null,
        tags: extracted.tags,
        company: ctx.company ?? null,
      })
      const employmentType = detectEmploymentType(extracted.title, extracted.description, ctx.employmentTypeHints ?? [])

      const result = await this.dedupe.upsert(normalized, {
        companyId: ctx.company?.id ?? undefined,
        employmentType,
        opportunityClass: cls.opportunityClass,
        classReason: cls.reason,
        firstSeenAt: ctx.firstSeenAt ?? null,
      })
      // v5: user-independent facts (geo constraints, locations, USD salary…) — computed once, evaluated per user.
      const facts = extractJobFacts({
        title: extracted.title,
        location: extracted.location,
        description: extracted.description,
        remoteType: extracted.remoteType,
        isRemoteFlag: ctx.isRemoteFlag ?? null,
        tags: extracted.tags,
        employmentType,
        seniority: normalized.seniority,
        category: normalized.category,
        skills: normalized.skills,
        salary: extracted.salary ?? null,
        company: ctx.company ?? null,
      })
      await this.prisma.jobFacts.upsert({ where: { jobId: result.job.id }, create: { jobId: result.job.id, facts: facts as unknown as Prisma.InputJsonValue, version: facts.version }, update: { facts: facts as unknown as Prisma.InputJsonValue, version: facts.version } })
      return { ...result, opportunityClass: cls.opportunityClass, classReason: cls.reason, employmentType, facts }
    } catch (err) {
      log.error(`Extraction failed for ${raw.sourceFingerprint}:`, err)
      return null
    }
  }

  /** Legacy helper kept for scripts: returns only the Job. */
  async processRawJobLegacy(raw: RawJob, source: NormalizeSource): Promise<Job | null> {
    const r = await this.processRawJob(raw, source)
    return r?.job ?? null
  }

  private async llmExtractTracked(raw: RawJob) {
    const today = new Date().toISOString().split('T')[0]
    const countKey = `llm:calls:${today}`
    const count = await this.redis.incr(countKey)
    if (count === 1) await this.redis.expire(countKey, 86400)
    try {
      return await llmExtract(raw)
    } catch (err) {
      log.warn(`LLM extraction failed for ${raw.sourceFingerprint}:`, err)
      return null
    }
  }
}
