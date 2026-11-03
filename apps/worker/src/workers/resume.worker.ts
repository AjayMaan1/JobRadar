import { Worker } from 'bullmq'
import { NeedsManualJdError } from '@jobradar/resume'
import { connection } from '../queues.js'
import { analysis, applyKit, llm, resumes, semantic, suggestions, tasks, versions } from '../context.js'
import { log } from '@jobradar/log'

export interface ResumeParsePayload { taskId: string; resumeId: string; userId: string }
export interface JdAnalyzePayload { taskId: string; jobId: string; userId: string | null; force?: boolean }
export interface AtsScorePayload { taskId: string; resumeVersionId: string; jobId: string; userId: string }
export interface SuggestPayload { taskId: string; reportId: string; userId: string; type: 'suggestions' | 'variants' | 'answers' | 'cover'; kind?: 'headline' | 'about'; tone?: 'conservative' | 'balanced' | 'assertive' }
export interface RenderPayload { taskId: string; versionId: string; userId: string }

const concurrency = parseInt(process.env.RESUME_CONCURRENCY ?? '1', 10)
/**
 * LLM lane: everything that talks to the local model runs with this concurrency (default 1 — a CPU-bound
 * Ollama serialises requests anyway, and two at once just doubles the wait for both).
 */
const llmConcurrency = parseInt(process.env.LLM_CONCURRENCY ?? '1', 10)

/** resume-parse: upload → text → parseability → structure (LLM) → master version → profile seed. */
export function startResumeParseWorker(): Worker<ResumeParsePayload> {
  return new Worker<ResumeParsePayload>(
    'resume-parse',
    async (job) => {
      const { taskId, resumeId } = job.data
      await tasks.running(taskId, 'Starting')
      try {
        const r = await resumes.parse(resumeId, llm, (m) => tasks.running(taskId, m))
        if (semantic) {
          const sem = semantic
          await tasks.running(taskId, 'Embedding')
          await sem.embedResumeVersion(r.version.id).catch((e) => log.warn('[embed] version failed:', (e as Error).message))
          if (r.resume.isMaster) await sem.embedProfile(r.resume.userId).then(() => sem.computeFitsForUser(r.resume.userId)).catch((e) => log.warn('[embed] profile failed:', (e as Error).message))
        }
        await tasks.done(taskId, { resumeId, versionId: r.version.id, status: r.resume.parseStatus, warnings: r.warnings.length })
        log.info(`[resume-parse] ${resumeId} → ${r.resume.parseStatus} (${r.warnings.length} warnings)`)
      } catch (err) {
        await tasks.failed(taskId, (err as Error).message)
        throw err
      }
    },
    { connection, concurrency: llmConcurrency }
  )
}

/** jd-analyze: requirements for one job (also usable from enrich later). */
export function startJdAnalyzeWorker(): Worker<JdAnalyzePayload> {
  return new Worker<JdAnalyzePayload>(
    'jd-analyze',
    async (job) => {
      const { taskId, jobId, userId, force } = job.data
      await tasks.running(taskId)
      try {
        const r = await analysis.ensureRequirements(jobId, { userId, force, onProgress: (m) => tasks.running(taskId, m) })
        await tasks.done(taskId, { jobId, cached: r.cached, required: r.requirements.required.length, preferred: r.requirements.preferred.length })
      } catch (err) {
        await tasks.failed(taskId, err instanceof NeedsManualJdError ? 'needs_manual_jd' : (err as Error).message)
        if (err instanceof NeedsManualJdError) return
        throw err
      }
    },
    { connection, concurrency: llmConcurrency }
  )
}

/** ats-score: (hydrate → requirements →) deterministic score → AtsReport. */
export function startAtsScoreWorker(): Worker<AtsScorePayload> {
  return new Worker<AtsScorePayload>(
    'ats-score',
    async (job) => {
      const { taskId, resumeVersionId, jobId, userId } = job.data
      await tasks.running(taskId)
      try {
        const r = await analysis.score(resumeVersionId, jobId, userId, { onProgress: (m) => tasks.running(taskId, m) })
        await tasks.done(taskId, { reportId: r.reportId, score: r.breakdown.score })
        log.info(`[ats-score] job ${jobId} version ${resumeVersionId} → ${r.breakdown.score}`)
      } catch (err) {
        await tasks.failed(taskId, err instanceof NeedsManualJdError ? 'needs_manual_jd' : (err as Error).message)
        if (err instanceof NeedsManualJdError) return
        throw err
      }
    },
    { connection, concurrency: llmConcurrency }
  )
}

/** suggest: improvement suggestions (C7), headline/about variants (C8), drafted answers (C10) — all grounded. */
export function startSuggestWorker(): Worker<SuggestPayload> {
  return new Worker<SuggestPayload>(
    'suggest',
    async (job) => {
      const { taskId, reportId, userId, type } = job.data
      await tasks.running(taskId)
      try {
        const progress = (m: string) => tasks.running(taskId, m)
        if (type === 'variants') {
          const n = await suggestions.generateVariants(reportId, userId, job.data.kind ?? 'headline', job.data.tone ?? 'balanced')
          await tasks.done(taskId, { reportId, variants: n, kind: job.data.kind })
        } else if (type === 'answers') {
          const n = await applyKit.draftAnswers(reportId, userId, progress)
          await tasks.done(taskId, { reportId, answers: n })
        } else if (type === 'cover') {
          const id = await applyKit.draftCoverLetter(reportId, userId, job.data.tone ?? 'balanced', progress)
          await tasks.done(taskId, { reportId, suggestionId: id })
        } else {
          const r = await suggestions.generate(reportId, userId, progress)
          await tasks.done(taskId, { reportId, count: r.count, llmUsed: r.llmUsed })
        }
      } catch (err) {
        await tasks.failed(taskId, (err as Error).message)
        throw err
      }
    },
    { connection, concurrency: llmConcurrency }
  )
}

/** resume-render: tailored version → PDF + DOCX → verify → store → re-score (C9). */
export function startResumeRenderWorker(): Worker<RenderPayload> {
  return new Worker<RenderPayload>(
    'resume-render',
    async (job) => {
      const { taskId, versionId, userId } = job.data
      await tasks.running(taskId)
      try {
        const r = await versions.render(versionId, userId, (m) => tasks.running(taskId, m))
        const changeLog = (r.version.changeLog as Record<string, unknown> | null) ?? {}
        await tasks.done(taskId, { versionId, scoreBefore: changeLog.scoreBefore ?? null, scoreAfter: r.scoreAfter, warnings: r.warnings.map((w) => w.code) })
        log.info(`[resume-render] ${versionId} rendered · score ${changeLog.scoreBefore ?? "?"} → ${r.scoreAfter ?? "?"}`)
      } catch (err) {
        await tasks.failed(taskId, (err as Error).message)
        throw err
      }
    },
    { connection, concurrency: parseInt(process.env.RENDER_CONCURRENCY ?? '2', 10) }
  )
}

export interface EmbedPayload { type: 'job' | 'profile' | 'version' | 'backfill'; jobId?: string; userId?: string; versionId?: string; taskId?: string }

/** embed: keep vectors + fits fresh (C13). Cheap; independent of the LLM lane. */
export function startEmbedWorker(): Worker<EmbedPayload> {
  return new Worker<EmbedPayload>(
    'embed',
    async (job) => {
      if (!semantic) return
      const d = job.data
      try {
        if (d.type === 'job' && d.jobId) { const v = await semantic.embedJob(d.jobId); await semantic.computeFitsForJob(d.jobId, v) }
        else if (d.type === 'profile' && d.userId) { await semantic.embedProfile(d.userId); const n = await semantic.computeFitsForUser(d.userId); log.info(`[embed] profile ${d.userId} → ${n} fits`) }
        else if (d.type === 'version' && d.versionId) await semantic.embedResumeVersion(d.versionId)
        else if (d.type === 'backfill') { const r = await semantic.backfillJobs(parseInt(process.env.EMBED_BACKFILL_BATCH ?? '100', 10)); if (r.embedded) log.info(`[embed] backfill: ${r.embedded} jobs, ${r.fits} fits`) }
        if (d.taskId) await tasks.done(d.taskId, { ok: true })
      } catch (err) {
        if (d.taskId) await tasks.failed(d.taskId, (err as Error).message)
        throw err
      }
    },
    { connection, concurrency: 1 }
  )
}
