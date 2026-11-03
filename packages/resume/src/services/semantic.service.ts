import type { Prisma, PrismaClient } from '@jobradar/db'
import type { EmbeddingProvider } from '@jobradar/llm'
import { jobChunks, profileChunks, requirementChunks, resumeChunks } from '../semantic/chunks.js'
import { EmbeddingService, fromBytes, type StoredVector } from '../semantic/embedding.service.js'
import { FIT_VERSION, semanticEvidence, semanticFit, type FitResult, type SemanticEvidence } from '../semantic/fit.js'
import { ResumeContentSchema } from '../schema/resume.js'
import type { JobRequirementsData } from '../jd/types.js'
import { findSkills } from '../skills/aliases.js'
import { effectiveDescription } from './analysis.service.js'

export interface SemanticBlock {
  version: string
  model: string
  fitScore: number | null
  topMatches: FitResult['topMatches']
  evidence: SemanticEvidence[]
}

/**
 * C13 orchestration: keeps embeddings fresh for jobs / resume versions / profiles and computes per-user
 * semantic fit (fit-v1). All CPU work is in the worker; the web tier only reads job_fits and embeddings.
 */
export class SemanticService {
  readonly embeddings: EmbeddingService
  constructor(private prisma: PrismaClient, provider: EmbeddingProvider) {
    this.embeddings = new EmbeddingService(prisma, provider)
  }

  get model(): string { return this.embeddings.provider.model }

  async embedJob(jobId: string): Promise<StoredVector[]> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { requirements: true } })
    if (!job) return []
    const reqs = job.requirements ? rowToData(job.requirements) : null
    // audit NEW-03: embed the text that analysis uses (crawled, else the user-pasted copy)
    const description = effectiveDescription(job)?.text ?? job.description
    return this.embeddings.ensure('job', jobId, jobChunks({ ...job, description }, reqs))
  }

  async embedResumeVersion(versionId: string): Promise<StoredVector[]> {
    const v = await this.prisma.resumeVersion.findUnique({ where: { id: versionId } })
    if (!v) return []
    return this.embeddings.ensure('resume_version', versionId, resumeChunks(ResumeContentSchema.parse(v.content)))
  }

  async embedProfile(userId: string): Promise<StoredVector[]> {
    const p = await this.prisma.candidateProfile.findUnique({ where: { userId } })
    if (!p) return []
    return this.embeddings.ensure('profile', userId, profileChunks({ headline: p.headline, about: p.about, targetTitles: p.targetTitles, skills: (p.skills as Array<{ canonical?: string; name?: string }>) ?? [] }))
  }

  async embedRequirements(jobId: string, reqs: JobRequirementsData): Promise<StoredVector[]> {
    return this.embeddings.ensure('requirement', jobId, requirementChunks(reqs))
  }

  /** Fit of one job for every user that has a profile vector (single-user: one row). */
  async computeFitsForJob(jobId: string, jobVectors?: StoredVector[]): Promise<number> {
    const vectors = jobVectors ?? (await this.embeddings.vectors('job', jobId))
    if (!vectors.length) return 0
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { title: true, description: true, skills: true } })
    const profiles = await this.prisma.embedding.findMany({ where: { ownerType: 'profile', model: this.model }, select: { ownerId: true, vector: true } })
    let n = 0
    for (const p of profiles) {
      const fit = semanticFit(fromBytes(p.vector), vectors)
      if (!fit) continue
      const profile = await this.prisma.candidateProfile.findUnique({ where: { userId: p.ownerId }, select: { skills: true } })
      const skills = ((profile?.skills as Array<{ canonical?: string; name?: string }> | null) ?? []).map((s) => (s.canonical ?? s.name ?? '').toLowerCase())
      const keyword = job ? keywordScore(skills, job) : null
      await this.prisma.jobFit.upsert({
        where: { userId_jobId: { userId: p.ownerId, jobId } },
        create: { userId: p.ownerId, jobId, fitScore: fit.fitScore, keywordScore: keyword, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model },
        update: { fitScore: fit.fitScore, keywordScore: keyword, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model },
      })
      n++
    }
    return n
  }

  /** Recompute a user's fits over open jobs that already have vectors (after a profile change). */
  async computeFitsForUser(userId: string, limit = 2000): Promise<number> {
    const [pv] = await this.embeddings.vectors('profile', userId)
    if (!pv) return 0
    // Only open jobs (closed ones are never ranked); vectors fetched in batches instead of one query per job.
    const heads = await this.prisma.embedding.findMany({ where: { ownerType: 'job', model: this.model, chunkKey: 'head' }, orderBy: { createdAt: 'desc' }, take: limit, select: { ownerId: true } })
    const open = new Set((await this.prisma.job.findMany({ where: { id: { in: heads.map((h) => h.ownerId) }, closedAt: null }, select: { id: true } })).map((j) => j.id))
    const ids = heads.map((h) => h.ownerId).filter((id) => open.has(id))
    const byJob = await this.embeddings.vectorsMany('job', ids)
    let n = 0
    for (const jobId of ids) {
      const fit = semanticFit(pv.vector, byJob.get(jobId) ?? [])
      if (!fit) continue
      await this.prisma.jobFit.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: { userId, jobId, fitScore: fit.fitScore, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model },
        update: { fitScore: fit.fitScore, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model },
      })
      n++
    }
    return n
  }

  /** Backfill: embed open jobs without vectors (oldest first is fine; newest first helps the inbox). */
  async backfillJobs(batch = 100): Promise<{ embedded: number; fits: number }> {
    const recent = await this.prisma.job.findMany({ where: { status: 'new', closedAt: null, opportunityClass: { in: ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'] } }, orderBy: { firstSeenAt: 'desc' }, take: 1500, select: { id: true } })
    const done = new Set((await this.prisma.embedding.findMany({ where: { ownerType: 'job', model: this.model, chunkKey: 'head', ownerId: { in: recent.map((r) => r.id) } }, select: { ownerId: true } })).map((e) => e.ownerId))
    const todo = recent.filter((r) => !done.has(r.id)).slice(0, batch)
    let fits = 0
    for (const { id } of todo) {
      const v = await this.embedJob(id)
      fits += await this.computeFitsForJob(id, v)
    }
    return { embedded: todo.length, fits }
  }

  /** Semantic block for a match report: profile fit + "not named but covered by" evidence for missing skills. */
  async forReport(versionId: string, jobId: string, userId: string, reqs: JobRequirementsData, missingSkills: string[]): Promise<SemanticBlock> {
    const [jobV, resumeV, reqV, [profileV]] = await Promise.all([this.embedJob(jobId), this.embedResumeVersion(versionId), this.embedRequirements(jobId, reqs), this.embeddings.vectors('profile', userId)])
    const fit = profileV ? semanticFit(profileV.vector, jobV) : null
    const missing = new Set(missingSkills)
    const evidence = semanticEvidence(reqV.filter((r) => missing.has(r.chunkKey.replace(/^req:/, ''))), resumeV)
    if (fit) {
      await this.prisma.jobFit.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId, fitScore: fit.fitScore, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model }, update: { fitScore: fit.fitScore, topMatches: fit.topMatches as unknown as Prisma.InputJsonValue, model: this.model } })
    }
    return { version: FIT_VERSION, model: this.model, fitScore: fit?.fitScore ?? null, topMatches: fit?.topMatches ?? [], evidence }
  }
}

function keywordScore(profileSkillsLower: string[], job: { title: string; description: string | null; skills: string }): number | null {
  if (!profileSkillsLower.length) return null
  let parsed: string[] = []
  try { parsed = JSON.parse(job.skills) } catch { /* ignore */ }
  const hits = findSkills(`${job.title}\n${job.description ?? ''}\n${parsed.join('\n')}`, { snippets: false })
  if (!hits.length) return null
  const have = new Set(profileSkillsLower)
  let num = 0, den = 0
  for (const h of hits) { const w = Math.min(3, h.count); den += w; if (have.has(h.canonical.toLowerCase())) num += w }
  return Math.round((num / den) * 100)
}

function rowToData(row: Prisma.JobRequirementsGetPayload<Record<string, never>>): JobRequirementsData {
  return { extractorVersion: row.extractorVersion, titleNormalized: row.titleNormalized, seniority: row.seniority as JobRequirementsData['seniority'], yearsMin: row.yearsMin, required: (row.required as unknown as JobRequirementsData['required']) ?? [], preferred: (row.preferred as unknown as JobRequirementsData['preferred']) ?? [], keywords: (row.keywords as unknown as JobRequirementsData['keywords']) ?? [], llmUsed: row.llmUsed, sections: {} }
}
