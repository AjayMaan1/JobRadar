import type { Job, Prisma, PrismaClient } from '@jobradar/db'
import type { LlmProvider } from '@jobradar/llm'
import { analyzeJd, descriptionHash, JD_EXTRACTOR_VERSION, type JobRequirementsData } from '../jd/index.js'
import { scoreResume, SCORER_VERSION, type AtsBreakdown } from '../score/ats-v1.js'
import { ResumeContentSchema } from '../schema/resume.js'
import type { ParseWarning } from '../parse/parseability.js'
import type { SemanticService } from './semantic.service.js'
import { log } from '@jobradar/log'

/** Fetches a fuller job description on demand (implemented in @jobradar/watchlist — it needs the crawler). */
export interface ApplicationQuestion {
  label: string
  required: boolean
  type: string
  name: string | null
  options: string[] | null
  description: string | null
}

export interface JdHydrator {
  hydrate(job: Job): Promise<{ description: string; source: 'hydrated' } | null>
  /** Public ATS application questions, when the ATS exposes them (Greenhouse). */
  questions?(job: Job): Promise<ApplicationQuestion[] | null>
}

export const MIN_DESCRIPTION_CHARS = 200

export class NeedsManualJdError extends Error {
  readonly code = 'needs_manual_jd'
  constructor(public jobId: string) {
    super('This job has no usable description. Paste the job description to continue.')
  }
}

export interface AnalysisDeps {
  llm: LlmProvider | null
  hydrator?: JdHydrator | null
  /** C13: semantic fit + evidence (worker only). */
  semantic?: SemanticService | null
}

type JobWithManual = Job & { descriptionManual?: string | null; descriptionManualBy?: string | null; descriptionManualAt?: Date | null }

/**
 * Which text to analyse (audit NEW-03): the crawled/hydrated description when usable, else the user-pasted copy.
 * The crawled text is never overwritten by a paste, and a later crawl/hydration automatically takes precedence.
 */
export function effectiveDescription(job: JobWithManual): { text: string; source: 'crawl' | 'manual' } | null {
  const crawled = (job.description ?? '').trim()
  if (crawled.length >= MIN_DESCRIPTION_CHARS) return { text: crawled, source: 'crawl' }
  const manual = (job.descriptionManual ?? '').trim()
  if (manual.length >= MIN_DESCRIPTION_CHARS) return { text: manual, source: 'manual' }
  if (crawled.length >= 80) return { text: crawled, source: 'crawl' } // short but analysable (title + a few lines)
  return null
}

/** True when the crawled text is unusable and a user paste would be accepted. */
export function manualDescriptionAllowed(job: JobWithManual): boolean {
  return (job.description ?? '').trim().length < MIN_DESCRIPTION_CHARS
}

export class AnalysisService {
  constructor(private prisma: PrismaClient, private deps: AnalysisDeps) {}

  /** Ensure job_requirements is fresh for the job's current description (hydrating it first if needed). */
  async ensureRequirements(jobId: string, opts: { userId?: string | null; force?: boolean; onProgress?: (m: string) => Promise<void> | void } = {}): Promise<{ job: Job; requirements: JobRequirementsData; cached: boolean }> {
    let job = (await this.prisma.job.findUnique({ where: { id: jobId } })) as JobWithManual | null
    if (!job) throw new Error('Job not found')

    let source: 'crawl' | 'hydrated' | 'manual' = 'crawl'
    if ((job.description ?? '').trim().length < MIN_DESCRIPTION_CHARS) {
      await opts.onProgress?.('Fetching full job description')
      const h = this.deps.hydrator ? await this.deps.hydrator.hydrate(job).catch((err) => { log.warn('[analysis] hydration failed', { jobId, reason: (err as Error).message }); return null }) : null
      if (h && h.description.length >= MIN_DESCRIPTION_CHARS) {
        job = (await this.prisma.job.update({ where: { id: jobId }, data: { description: h.description } })) as JobWithManual
        source = 'hydrated'
      }
    }
    const eff = effectiveDescription(job)
    if (!eff) throw new NeedsManualJdError(jobId)
    if (eff.source === 'manual') source = 'manual'
    const existing = await this.prisma.jobRequirements.findUnique({ where: { jobId } })
    const hash = descriptionHash(job.title, eff.text)
    if (!opts.force && existing && existing.descriptionHash === hash && existing.extractorVersion === JD_EXTRACTOR_VERSION && (existing.llmUsed || !this.deps.llm)) {
      return { job, requirements: rowToData(existing), cached: true }
    }

    await opts.onProgress?.('Extracting requirements')
    const requirements = await analyzeJd(job.title, eff.text, this.deps.llm, opts.userId)
    await this.prisma.jobRequirements.upsert({
      where: { jobId },
      create: { jobId, descriptionHash: hash, extractorVersion: requirements.extractorVersion, descriptionSource: source, ...dataToRow(requirements) },
      update: { descriptionHash: hash, extractorVersion: requirements.extractorVersion, descriptionSource: source, ...dataToRow(requirements) },
    })
    // Real skills for the feed/ranking (fixes departments-as-skills for board jobs; audit F4) and the years
    // requirement for the experience filter (audit NEW-11 / old F9).
    const skills = [...requirements.required, ...requirements.preferred].map((r) => r.skill)
    const data: Record<string, unknown> = {}
    if (skills.length) data.skills = JSON.stringify([...new Set(skills)].slice(0, 40))
    if (requirements.yearsMin !== null && requirements.yearsMin !== undefined && job.experienceMin === null) data.experienceMin = requirements.yearsMin
    if (Object.keys(data).length) job = (await this.prisma.job.update({ where: { id: jobId }, data })) as JobWithManual
    return { job, requirements, cached: false }
  }

  /**
   * User pasted the JD by hand (audit NEW-03): stored beside the crawled text with provenance, only when the
   * crawled text is unusable. Never overwrites `description`.
   */
  async setManualDescription(jobId: string, description: string, userId?: string | null): Promise<JobRequirementsData> {
    const text = description.trim()
    if (text.length < MIN_DESCRIPTION_CHARS) throw new Error(`Description too short (min ${MIN_DESCRIPTION_CHARS} characters)`)
    const job = (await this.prisma.job.findUnique({ where: { id: jobId } })) as JobWithManual | null
    if (!job) throw new Error('Job not found')
    if (!manualDescriptionAllowed(job)) throw new Error('This job already has a description; paste is only offered when the crawled text is unusable')
    await this.prisma.job.update({ where: { id: jobId }, data: { descriptionManual: text.slice(0, 60_000), descriptionManualBy: userId ?? null, descriptionManualAt: new Date() } as never })
    const r = await this.ensureRequirements(jobId, { userId, force: true })
    return r.requirements
  }

  /** Score one resume version against one job; stores/refreshes the AtsReport. */
  async score(resumeVersionId: string, jobId: string, userId: string, opts: { onProgress?: (m: string) => Promise<void> | void } = {}): Promise<{ reportId: string; breakdown: AtsBreakdown; requirements: JobRequirementsData; cachedRequirements: boolean }> {
    const version = await this.prisma.resumeVersion.findUnique({ where: { id: resumeVersionId }, include: { resume: { select: { userId: true, parseWarnings: true } } } })
    if (!version || version.resume.userId !== userId) throw new Error('Resume version not found')
    const { requirements, cached } = await this.ensureRequirements(jobId, { userId, onProgress: opts.onProgress })
    await opts.onProgress?.('Scoring')
    const content = ResumeContentSchema.parse(version.content)
    // Parse warnings apply to the uploaded document (master/correction). Tailored versions are re-verified after render (C9).
    const warnings = version.kind === 'tailored'
      ? ((version.renderWarnings as unknown as ParseWarning[] | null) ?? [])
      : ((version.resume.parseWarnings as unknown as ParseWarning[]) ?? [])
    const breakdown = scoreResume(content, requirements, warnings) as AtsBreakdown & { semantic?: unknown }
    if (this.deps.semantic) {
      await opts.onProgress?.('Semantic fit')
      try {
        breakdown.semantic = await this.deps.semantic.forReport(resumeVersionId, jobId, userId, requirements, breakdown.missing.map((m) => m.skill))
      } catch (err) {
        log.warn('[analysis] semantic block failed:', (err as Error).message)
      }
    }
    const report = await this.prisma.atsReport.upsert({
      where: { resumeVersionId_jobId_scorerVersion: { resumeVersionId, jobId, scorerVersion: SCORER_VERSION } },
      create: { resumeVersionId, jobId, scorerVersion: SCORER_VERSION, score: breakdown.score, breakdown: breakdown as unknown as Prisma.InputJsonValue },
      update: { score: breakdown.score, breakdown: breakdown as unknown as Prisma.InputJsonValue, createdAt: new Date() },
    })
    return { reportId: report.id, breakdown, requirements, cachedRequirements: cached }
  }

  async getReport(reportId: string, userId: string) {
    const r = await this.prisma.atsReport.findUnique({ where: { id: reportId }, include: { resumeVersion: { select: { id: true, kind: true, resumeId: true, resume: { select: { userId: true, label: true } } } }, job: { select: { id: true, title: true, company: true, applyUrl: true } } } })
    if (!r || r.resumeVersion.resume.userId !== userId) return null
    const requirements = await this.prisma.jobRequirements.findUnique({ where: { jobId: r.jobId } })
    return { id: r.id, score: r.score, scorerVersion: r.scorerVersion, createdAt: r.createdAt, breakdown: r.breakdown as unknown as AtsBreakdown, job: r.job, resumeVersion: { id: r.resumeVersion.id, kind: r.resumeVersion.kind, resumeId: r.resumeVersion.resumeId, label: r.resumeVersion.resume.label }, requirements: requirements ? rowToData(requirements) : null }
  }
}

type Row = Prisma.JobRequirementsGetPayload<Record<string, never>>

function rowToData(row: Row): JobRequirementsData {
  return {
    extractorVersion: row.extractorVersion,
    titleNormalized: row.titleNormalized,
    seniority: (row.seniority as JobRequirementsData['seniority']) ?? null,
    yearsMin: row.yearsMin,
    required: (row.required as unknown as JobRequirementsData['required']) ?? [],
    preferred: (row.preferred as unknown as JobRequirementsData['preferred']) ?? [],
    keywords: (row.keywords as unknown as JobRequirementsData['keywords']) ?? [],
    llmUsed: row.llmUsed,
    sections: {},
  }
}

function dataToRow(d: JobRequirementsData) {
  return {
    titleNormalized: d.titleNormalized,
    seniority: d.seniority,
    yearsMin: d.yearsMin,
    required: d.required as unknown as Prisma.InputJsonValue,
    preferred: d.preferred as unknown as Prisma.InputJsonValue,
    keywords: d.keywords as unknown as Prisma.InputJsonValue,
    llmUsed: d.llmUsed,
  }
}
