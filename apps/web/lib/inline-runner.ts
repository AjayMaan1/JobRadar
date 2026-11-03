import { prisma } from '@jobradar/db'
import { createEmbeddingProvider, createLlmProvider, type LlmProvider } from '@jobradar/llm'
import type { ObjectStore } from '@jobradar/storage'
import { AnalysisService, ApplyKitService, NeedsManualJdError, ResumeService, SemanticService, SuggestionService, TaskTracker, VersionService } from '@jobradar/resume'
import { CrawlScopeService, EvalService } from '@jobradar/prefs'
import { log } from '@jobradar/log'

/**
 * QUEUE_MODE=inline — run worker handlers inside the web process, serially, with no Redis/BullMQ.
 * For single-box installs and for tests. Differences from the worker: no crawler gateway (JD hydration is
 * unavailable → the "paste the description" fallback appears), and PDFs use the simple renderer unless
 * Chromium is present. Everything else (parse, score, suggest, variants, answers, render, embed) is the
 * same code as the worker.
 */
export interface InlineQueue {
  add(name: string, data: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ id: string }>
}

/** Audit NEW-13: bound the in-process queue so a burst cannot pile up unboundedly behind one slow LLM call. */
export const INLINE_MAX_PENDING = parseInt(process.env.INLINE_MAX_PENDING ?? '50', 10)

export class InlineQueueFullError extends Error {
  readonly code = 'queue_full'
  constructor() { super(`Too much background work queued (limit ${INLINE_MAX_PENDING}); try again in a minute`) }
}

export class InlineRunner {
  private chain: Promise<void> = Promise.resolve()
  private llm: LlmProvider | null
  private semantic: SemanticService | null
  private resumes: ResumeService
  private analysis: AnalysisService
  private suggestions: SuggestionService
  private versions: VersionService
  private applyKit: ApplyKitService
  private evals: EvalService
  private crawlScope: CrawlScopeService
  readonly pending = { count: 0 }

  constructor(private tasks: TaskTracker, store: ObjectStore) {
    let llm: LlmProvider | null = null
    // Budgeted even without Redis (audit NEW-04): createLlmProvider falls back to an in-process budget store.
    try { llm = createLlmProvider() } catch (err) { log.warn('[inline] LLM disabled', { reason: (err as Error).message }) }
    this.llm = llm
    const emb = (() => { try { return createEmbeddingProvider() } catch { return null } })()
    this.semantic = emb ? new SemanticService(prisma, emb) : null
    this.resumes = new ResumeService(prisma, store)
    this.analysis = new AnalysisService(prisma, { llm, hydrator: null, semantic: this.semantic })
    this.suggestions = new SuggestionService(prisma, { llm })
    this.versions = new VersionService(prisma, store, { pdf: null, analysis: this.analysis, renderer: 'simple' })
    this.applyKit = new ApplyKitService(prisma, store, { llm, hydrator: null })
    this.evals = new EvalService(prisma)
    this.crawlScope = new CrawlScopeService(prisma, this.evals)
  }

  queue(name: string): InlineQueue {
    return { add: async (_job, data) => { this.enqueue(name, data); return { id: `inline:${name}:${Date.now()}` } } }
  }

  private enqueue(queue: string, data: Record<string, unknown>): void {
    if (this.pending.count >= INLINE_MAX_PENDING) throw new InlineQueueFullError()
    this.pending.count++
    this.chain = this.chain.then(() => this.run(queue, data)).catch(() => undefined).finally(() => { this.pending.count-- })
  }

  private async run(queue: string, d: Record<string, unknown>): Promise<void> {
    const taskId = typeof d.taskId === 'string' ? d.taskId : null
    const progress = (m: string) => (taskId ? this.tasks.running(taskId, m) : Promise.resolve())
    try {
      if (taskId) await this.tasks.running(taskId)
      switch (queue) {
        case 'resume-parse': {
          const r = await this.resumes.parse(String(d.resumeId), this.llm, progress)
          if (this.semantic) {
            await progress('Embedding')
            await this.semantic.embedResumeVersion(r.version.id).catch(() => undefined)
            if (r.resume.isMaster) await this.semantic.embedProfile(r.resume.userId).then(() => this.semantic!.computeFitsForUser(r.resume.userId)).catch(() => undefined)
          }
          if (taskId) await this.tasks.done(taskId, { resumeId: r.resume.id, versionId: r.version.id, status: r.resume.parseStatus, warnings: r.warnings.length })
          break
        }
        case 'jd-analyze': {
          const r = await this.analysis.ensureRequirements(String(d.jobId), { userId: (d.userId as string) ?? null, force: Boolean(d.force), onProgress: progress })
          if (taskId) await this.tasks.done(taskId, { jobId: d.jobId, cached: r.cached, required: r.requirements.required.length })
          break
        }
        case 'ats-score': {
          const r = await this.analysis.score(String(d.resumeVersionId), String(d.jobId), String(d.userId), { onProgress: progress })
          if (taskId) await this.tasks.done(taskId, { reportId: r.reportId, score: r.breakdown.score })
          break
        }
        case 'suggest': {
          const type = String(d.type ?? 'suggestions')
          if (type === 'variants') { const n = await this.suggestions.generateVariants(String(d.reportId), String(d.userId), (d.kind as 'headline') ?? 'headline', (d.tone as 'balanced') ?? 'balanced'); if (taskId) await this.tasks.done(taskId, { variants: n }) }
          else if (type === 'answers') { const n = await this.applyKit.draftAnswers(String(d.reportId), String(d.userId), progress); if (taskId) await this.tasks.done(taskId, { answers: n }) }
          else if (type === 'cover') { const id = await this.applyKit.draftCoverLetter(String(d.reportId), String(d.userId), (d.tone as 'balanced') ?? 'balanced', progress); if (taskId) await this.tasks.done(taskId, { suggestionId: id }) }
          else { const r = await this.suggestions.generate(String(d.reportId), String(d.userId), progress); if (taskId) await this.tasks.done(taskId, { count: r.count, llmUsed: r.llmUsed }) }
          break
        }
        case 'resume-render': {
          const r = await this.versions.render(String(d.versionId), String(d.userId), progress)
          const changeLog = (r.version.changeLog as Record<string, unknown> | null) ?? {}
          if (taskId) await this.tasks.done(taskId, { versionId: d.versionId, scoreBefore: changeLog.scoreBefore ?? null, scoreAfter: r.scoreAfter, warnings: r.warnings.map((w) => w.code) })
          break
        }
        case 'prefs-reeval': {
          this.evals.invalidateUsers()
          const r = await this.evals.reevaluateUser(String(d.userId), Number(d.version), { onProgress: async (done, total) => { if (taskId) await this.tasks.running(taskId, `Re-evaluated ${done} of ${total} open jobs`) } })
          const applied = await this.crawlScope.autoApplyIfSingleUser().catch(() => 0)
          if (taskId) await this.tasks.done(taskId, { evaluated: r.evaluated, superseded: r.skipped, crawlScopeApplied: applied })
          break
        }
        case 'embed': {
          if (!this.semantic) break
          if (d.type === 'job' && d.jobId) { const v = await this.semantic.embedJob(String(d.jobId)); await this.semantic.computeFitsForJob(String(d.jobId), v) }
          else if (d.type === 'profile' && d.userId) { await this.semantic.embedProfile(String(d.userId)); await this.semantic.computeFitsForUser(String(d.userId)) }
          else if (d.type === 'version' && d.versionId) await this.semantic.embedResumeVersion(String(d.versionId))
          break
        }
        default:
          throw new Error(`inline runner: unknown queue ${queue}`)
      }
    } catch (err) {
      const msg = err instanceof NeedsManualJdError ? 'needs_manual_jd' : (err as Error).message
      if (taskId) await this.tasks.failed(taskId, msg)
      else log.warn(`[inline] ${queue} failed`, { reason: msg })
    }
  }
}
