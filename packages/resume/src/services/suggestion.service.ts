import type { Prisma, PrismaClient, Suggestion } from '@jobradar/db'
import type { LlmProvider } from '@jobradar/llm'
import { validateGrounding, type GroundingResult } from '../ground/validate.js'
import type { JobRequirementsData } from '../jd/types.js'
import type { ParseWarning } from '../parse/parseability.js'
import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { scoreResume, type AtsBreakdown } from '../score/ats-v1.js'
import { applyProposal } from '../suggest/apply.js'
import { deterministicProposals } from '../suggest/deterministic.js'
import { headlineVariants, type Tone } from '../suggest/headline.js'
import { llmBulletFromFact, llmProposals } from '../suggest/llm.js'
import type { Proposal } from '../suggest/types.js'
import { log } from '@jobradar/log'

export interface SuggestionDeps {
  llm: LlmProvider | null
}

interface ReportContext {
  reportId: string
  userId: string
  jobId: string
  content: ResumeContent
  requirements: JobRequirementsData
  breakdown: AtsBreakdown
  warnings: ParseWarning[]
  confirmedFacts: string[]
}

export class SuggestionService {
  constructor(private prisma: PrismaClient, private deps: SuggestionDeps) {}

  private async context(reportId: string, userId: string): Promise<ReportContext> {
    const report = await this.prisma.atsReport.findUnique({
      where: { id: reportId },
      include: { resumeVersion: { include: { resume: { select: { userId: true, parseWarnings: true } } } }, job: { include: { requirements: true } } },
    })
    if (!report || report.resumeVersion.resume.userId !== userId) throw new Error('Report not found')
    const reqRow = report.job.requirements
    if (!reqRow) throw new Error('Job requirements missing — run the analysis first')
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { confirmedFacts: true } })
    const v = report.resumeVersion
    const warnings = (v.kind === 'tailored' ? (v.renderWarnings as unknown as ParseWarning[] | null) : (v.resume.parseWarnings as unknown as ParseWarning[])) ?? []
    return {
      reportId,
      userId,
      jobId: report.jobId,
      content: ResumeContentSchema.parse(v.content),
      requirements: {
        extractorVersion: reqRow.extractorVersion,
        titleNormalized: reqRow.titleNormalized,
        seniority: reqRow.seniority as JobRequirementsData['seniority'],
        yearsMin: reqRow.yearsMin,
        required: (reqRow.required as unknown as JobRequirementsData['required']) ?? [],
        preferred: (reqRow.preferred as unknown as JobRequirementsData['preferred']) ?? [],
        keywords: (reqRow.keywords as unknown as JobRequirementsData['keywords']) ?? [],
        llmUsed: reqRow.llmUsed,
        sections: {},
      },
      breakdown: report.breakdown as unknown as AtsBreakdown,
      warnings,
      confirmedFacts: ((profile?.confirmedFacts as string[] | null) ?? []).filter((f) => typeof f === 'string'),
    }
  }

  /** Grounding + expected gain for a proposal; returns the row data to persist. */
  private evaluate(ctx: ReportContext, p: Proposal): Prisma.SuggestionUncheckedCreateInput {
    let grounding: GroundingResult | null = null
    let expectedGain: number | null = null
    if (p.after && ['bullet_rewrite', 'skills_section', 'headline', 'about'].includes(p.kind)) {
      grounding = validateGrounding(p.after, { master: ctx.content, confirmedFacts: ctx.confirmedFacts, allow: p.before ? [p.before] : [] })
    }
    if (p.after && ['bullet_rewrite', 'skills_section', 'reorder', 'headline', 'about'].includes(p.kind)) {
      try {
        const applied = applyProposal(ctx.content, p)
        expectedGain = scoreResume(applied, ctx.requirements, ctx.warnings).score - ctx.breakdown.score
      } catch { expectedGain = null }
    }
    return {
      reportId: ctx.reportId,
      kind: p.kind,
      targetPath: p.targetPath ?? null,
      before: p.before ?? null,
      after: p.after ?? null,
      rationale: p.rationale,
      jdEvidence: p.jdEvidence ?? null,
      skill: p.skill ?? null,
      variant: p.variant ?? null,
      question: p.question ?? null,
      grounding: grounding ? (grounding as unknown as Prisma.InputJsonValue) : undefined,
      flagged: grounding ? !grounding.ok : false,
      expectedGain,
    }
  }

  /** (Re)generate suggestions for a report. Pending ones are replaced; answered/accepted/edited/rejected are kept. */
  async generate(reportId: string, userId: string, onProgress?: (m: string) => Promise<void> | void): Promise<{ count: number; llmUsed: boolean }> {
    const ctx = await this.context(reportId, userId)
    await onProgress?.('Checking your resume against the posting')
    const proposals: Proposal[] = deterministicProposals(ctx.content, ctx.requirements, ctx.breakdown, ctx.warnings)
    // don't re-ask confirmed questions
    const answered = await this.prisma.suggestion.findMany({ where: { reportId, kind: 'keyword_confirm', status: { not: 'pending' } }, select: { skill: true } })
    const answeredSkills = new Set(answered.map((a) => a.skill))
    let llmUsed = false
    if (this.deps.llm) {
      await onProgress?.('Drafting rewrites with AI')
      try {
        proposals.push(...(await llmProposals(ctx.content, ctx.requirements, ctx.breakdown, ctx.confirmedFacts, this.deps.llm, userId)))
        llmUsed = true
      } catch (err) {
        log.warn('[suggest] LLM proposals failed:', (err as Error).message)
      }
    }
    const rows = proposals
      .filter((p) => !(p.kind === 'keyword_confirm' && answeredSkills.has(p.skill ?? '')))
      .map((p) => this.evaluate(ctx, p))
      // drop rewrites that don't help and are flagged — pure noise
      .filter((r) => !(r.kind === 'bullet_rewrite' && r.flagged && (r.expectedGain ?? 0) <= 0))
    await this.prisma.$transaction([
      this.prisma.suggestion.deleteMany({ where: { reportId, status: 'pending', kind: { notIn: ['headline', 'about', 'answer'] } } }),
      ...rows.map((data) => this.prisma.suggestion.create({ data })),
    ])
    return { count: rows.length, llmUsed }
  }

  /** C8: opt-in headline/about variants. Replaces pending variants of that kind for the report. */
  async generateVariants(reportId: string, userId: string, kind: 'headline' | 'about', tone: Tone = 'balanced'): Promise<number> {
    if (!this.deps.llm) throw new Error('An LLM provider is required for headline/about variants')
    const ctx = await this.context(reportId, userId)
    const proposals = await headlineVariants(kind, ctx.content, ctx.requirements, ctx.confirmedFacts, this.deps.llm, { tone, userId })
    const rows = proposals.map((p) => this.evaluate(ctx, p))
    await this.prisma.$transaction([
      this.prisma.suggestion.deleteMany({ where: { reportId, kind, status: 'pending' } }),
      ...rows.map((data) => this.prisma.suggestion.create({ data })),
    ])
    return rows.length
  }

  async list(reportId: string, userId: string): Promise<Suggestion[]> {
    await this.context(reportId, userId) // ownership check
    return this.prisma.suggestion.findMany({ where: { reportId }, orderBy: [{ kind: 'asc' }, { expectedGain: 'desc' }, { createdAt: 'asc' }] })
  }

  private async owned(id: string, userId: string) {
    const s = await this.prisma.suggestion.findUnique({ where: { id }, include: { report: { include: { resumeVersion: { include: { resume: { select: { userId: true } } } } } } } })
    if (!s || s.report.resumeVersion.resume.userId !== userId) throw new Error('Suggestion not found')
    return s
  }

  /** accept | reject | edited (with userEdit). Edits are re-validated; the user's own words are allowed but flagged facts are shown. */
  async setStatus(id: string, userId: string, status: 'accepted' | 'rejected' | 'edited' | 'pending', userEdit?: string | null): Promise<Suggestion> {
    const s = await this.owned(id, userId)
    if (s.kind === 'keyword_confirm') throw new Error('Use confirm-fact for questions')
    const data: Prisma.SuggestionUncheckedUpdateInput = { status }
    if (status === 'edited') {
      const text = (userEdit ?? '').trim()
      if (!text) throw new Error('userEdit is required for status=edited')
      const ctx = await this.context(s.reportId, userId)
      const grounding = validateGrounding(text, { master: ctx.content, confirmedFacts: ctx.confirmedFacts, allow: s.before ? [s.before] : [] })
      data.userEdit = text
      data.grounding = grounding as unknown as Prisma.InputJsonValue
      data.flagged = !grounding.ok
      try {
        const p: Proposal = { kind: s.kind as Proposal['kind'], targetPath: s.targetPath, before: s.before, after: text, rationale: s.rationale }
        data.expectedGain = scoreResume(applyProposal(ctx.content, p), ctx.requirements, ctx.warnings).score - ctx.breakdown.score
      } catch { /* keep previous */ }
    }
    if (status === 'accepted' && s.flagged) {
      // Accepting a flagged suggestion is the user's explicit call; record it.
      data.userEdit = s.userEdit ?? s.after
    }
    return this.prisma.suggestion.update({ where: { id }, data })
  }

  /** keyword_confirm answer. "yes" + context → confirmed fact + grounded bullet + skills-section suggestion. */
  async confirmFact(id: string, userId: string, input: { yes: boolean; context?: string }): Promise<{ suggestion: Suggestion; created: Suggestion[] }> {
    const s = await this.owned(id, userId)
    if (s.kind !== 'keyword_confirm' || !s.skill) throw new Error('Not a confirm question')
    const context = (input.context ?? '').trim()
    const updated = await this.prisma.suggestion.update({ where: { id }, data: { status: 'answered', answer: { yes: input.yes, context } as Prisma.InputJsonValue } })
    const created: Suggestion[] = []
    if (!input.yes) return { suggestion: updated, created }

    const fact = context ? `${s.skill}: ${context}` : `Has professional experience with ${s.skill}`
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } })
    const facts = ((profile?.confirmedFacts as string[] | null) ?? []).filter((f) => typeof f === 'string')
    if (!facts.includes(fact)) {
      const skills = ((profile?.skills as Array<{ name: string; canonical: string }> | null) ?? [])
      if (!skills.some((x) => x.canonical.toLowerCase() === s.skill!.toLowerCase())) skills.push({ name: s.skill, canonical: s.skill, confirmed: true, source: 'confirmed' } as never)
      await this.prisma.candidateProfile.upsert({
        where: { userId },
        create: { userId, confirmedFacts: [...facts, fact] as unknown as Prisma.InputJsonValue, skills: skills as unknown as Prisma.InputJsonValue },
        update: { confirmedFacts: [...facts, fact] as unknown as Prisma.InputJsonValue, skills: skills as unknown as Prisma.InputJsonValue },
      })
    }
    const ctx = await this.context(s.reportId, userId)
    const proposals: Proposal[] = []
    // skills-section add is grounded by the confirmation itself
    const idx = ctx.content.skills.length ? ctx.content.skills.length - 1 : null
    proposals.push({ kind: 'skills_section', targetPath: idx === null ? null : `/skills/${idx}/keywords`, before: idx === null ? '' : ctx.content.skills[idx].keywords.join(', '), after: s.skill, rationale: `You confirmed ${s.skill}; add it to your skills list so keyword matching finds it.`, skill: s.skill })
    if (this.deps.llm && context.length >= 15) {
      try {
        const b = await llmBulletFromFact(ctx.content, s.skill, context, ctx.requirements, this.deps.llm, userId)
        if (b) proposals.push(b)
      } catch (err) {
        log.warn('[suggest] bullet-from-fact failed:', (err as Error).message)
      }
    }
    for (const p of proposals) {
      const row = this.evaluate(ctx, p)
      // the confirmation text is allowed evidence for this bullet
      if (p.kind === 'bullet_rewrite' && p.after) {
        const g = validateGrounding(p.after, { master: ctx.content, confirmedFacts: [...ctx.confirmedFacts, fact], allow: [context] })
        row.grounding = g as unknown as Prisma.InputJsonValue
        row.flagged = !g.ok
      }
      created.push(await this.prisma.suggestion.create({ data: row }))
    }
    return { suggestion: updated, created }
  }
}
