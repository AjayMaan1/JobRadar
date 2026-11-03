import type { Prisma, PrismaClient } from '@jobradar/db'
import type { LlmProvider } from '@jobradar/llm'
import type { ObjectStore } from '@jobradar/storage'
import { validateGrounding } from '../ground/validate.js'
import type { JobRequirementsData } from '../jd/types.js'
import { ResumeContentSchema } from '../schema/resume.js'
import { ATS_NOTES, detectApplyAts } from '../apply/ats.js'
import { deterministicAnswers, llmAnswers, type ApplyDefaults } from '../apply/answers.js'
import { draftCoverLetter, type CoverTone } from '../apply/cover.js'
import type { AtsBreakdown } from '../score/ats-v1.js'
import type { ApplicationQuestion, JdHydrator } from './analysis.service.js'
import { log } from '@jobradar/log'

export interface ApplyKitDeps {
  llm: LlmProvider | null
  hydrator?: JdHydrator | null
}

export interface RecordApplicationInput {
  resumeVersionId?: string | null
  headlineUsed?: string | null
  aboutUsed?: string | null
  coverNote?: string | null
  answers?: Array<{ question: string; answer: string }> | null
  submittedVia?: 'manual' | 'extension'
  status?: 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn'
  note?: string | null
  /** GH-5: schedule a follow-up reminder (ISO date) or clear it (null). Undefined = unchanged. */
  followUpAt?: string | null
}

/**
 * Apply Kit (backlog C10): everything needed to apply on the employer's site, and the record of what was sent.
 * Nothing here submits anything anywhere (HLD V5).
 */
export class ApplyKitService {
  constructor(private prisma: PrismaClient, private store: ObjectStore, private deps: ApplyKitDeps) {}

  /** Questions for the job, cached on job_requirements.application_questions. */
  async questions(jobId: string, refresh = false): Promise<ApplicationQuestion[]> {
    const req = await this.prisma.jobRequirements.findUnique({ where: { jobId }, select: { applicationQuestions: true } })
    if (!refresh && req?.applicationQuestions) return req.applicationQuestions as unknown as ApplicationQuestion[]
    if (!this.deps.hydrator?.questions) return []
    const job = await this.prisma.job.findUnique({ where: { id: jobId } })
    if (!job) return []
    const qs = (await this.deps.hydrator.questions(job)) ?? []
    await this.prisma.jobRequirements.upsert({
      where: { jobId },
      create: { jobId, descriptionHash: '', extractorVersion: '', applicationQuestions: qs as unknown as Prisma.InputJsonValue },
      update: { applicationQuestions: qs as unknown as Prisma.InputJsonValue },
    })
    return qs
  }

  /** Draft answers for a report's job (worker). Stored as suggestions(kind=answer) so the user edits/accepts them like everything else. */
  async draftAnswers(reportId: string, userId: string, onProgress?: (m: string) => Promise<void> | void): Promise<number> {
    const report = await this.prisma.atsReport.findUnique({ where: { id: reportId }, include: { job: { include: { requirements: true } }, resumeVersion: { include: { resume: { select: { userId: true } } } } } })
    if (!report || report.resumeVersion.resume.userId !== userId) throw new Error('Report not found')
    await onProgress?.('Fetching application questions')
    const questions = await this.questions(report.jobId)
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } })
    const defaults = ((profile?.applyDefaults as ApplyDefaults | null) ?? {})
    const content = ResumeContentSchema.parse(report.resumeVersion.content)
    const confirmed = ((profile?.confirmedFacts as string[] | null) ?? []).filter((f) => typeof f === 'string')
    const reqRow = report.job.requirements
    const reqs: JobRequirementsData = { extractorVersion: reqRow?.extractorVersion ?? '', titleNormalized: reqRow?.titleNormalized ?? null, seniority: (reqRow?.seniority as JobRequirementsData['seniority']) ?? null, yearsMin: reqRow?.yearsMin ?? null, required: (reqRow?.required as unknown as JobRequirementsData['required']) ?? [], preferred: (reqRow?.preferred as unknown as JobRequirementsData['preferred']) ?? [], keywords: (reqRow?.keywords as unknown as JobRequirementsData['keywords']) ?? [], llmUsed: reqRow?.llmUsed ?? false, sections: {} }

    // Always offer a "why this role" note even when the ATS has no custom questions.
    const allQuestions: ApplicationQuestion[] = questions.length ? questions : [{ label: 'Why are you interested in this role and what makes you a strong fit?', required: false, type: 'textarea', name: null, options: null, description: null }]
    const { answered, open } = deterministicAnswers(allQuestions, defaults, content)
    const drafted = [...answered]
    if (this.deps.llm && open.length) {
      await onProgress?.('Drafting answers with AI')
      try {
        drafted.push(...(await llmAnswers(open, content, reqs, { title: report.job.title, company: report.job.company }, confirmed, this.deps.llm, userId)))
      } catch (err) {
        log.warn('[applykit] answer drafting failed:', (err as Error).message)
      }
    }
    const rows: Prisma.SuggestionUncheckedCreateInput[] = drafted.map((d) => {
      const g = d.source === 'llm' ? validateGrounding(d.after ?? '', { master: content, confirmedFacts: confirmed, allow: Object.values(defaults).filter((v): v is string => Boolean(v)) }) : null
      return { reportId, kind: 'answer', question: d.question, after: d.after ?? '', rationale: d.rationale, grounding: g ? (g as unknown as Prisma.InputJsonValue) : undefined, flagged: g ? !g.ok : false }
    })
    await this.prisma.$transaction([
      this.prisma.suggestion.deleteMany({ where: { reportId, kind: 'answer', status: 'pending' } }),
      ...rows.map((data) => this.prisma.suggestion.create({ data })),
    ])
    return rows.length
  }

  /** Cover note (GH-8): grounded draft stored as a `cover_letter` suggestion for the user to edit/accept. */
  async draftCoverLetter(reportId: string, userId: string, tone: CoverTone = 'balanced', onProgress?: (m: string) => Promise<void> | void): Promise<string> {
    const report = await this.prisma.atsReport.findUnique({ where: { id: reportId }, include: { job: { include: { requirements: true } }, resumeVersion: { include: { resume: { select: { userId: true } } } } } })
    if (!report || report.resumeVersion.resume.userId !== userId) throw new Error('Report not found')
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } })
    const content = ResumeContentSchema.parse(report.resumeVersion.content)
    const confirmed = ((profile?.confirmedFacts as string[] | null) ?? []).filter((f) => typeof f === 'string')
    const reqRow = report.job.requirements
    const reqs: JobRequirementsData = { extractorVersion: reqRow?.extractorVersion ?? '', titleNormalized: reqRow?.titleNormalized ?? null, seniority: (reqRow?.seniority as JobRequirementsData['seniority']) ?? null, yearsMin: reqRow?.yearsMin ?? null, required: (reqRow?.required as unknown as JobRequirementsData['required']) ?? [], preferred: (reqRow?.preferred as unknown as JobRequirementsData['preferred']) ?? [], keywords: (reqRow?.keywords as unknown as JobRequirementsData['keywords']) ?? [], llmUsed: reqRow?.llmUsed ?? false, sections: {} }
    const matched = ((report.breakdown as unknown as AtsBreakdown | null)?.matched ?? [])
    await onProgress?.(this.deps.llm ? 'Drafting cover note with AI' : 'Assembling cover note')
    const p = await draftCoverLetter({ content, requirements: reqs, job: { title: report.job.title, company: report.job.company }, matched, confirmedFacts: confirmed, tone }, this.deps.llm, userId)
    const g = validateGrounding(p.after ?? '', { master: content, confirmedFacts: confirmed, allow: [report.job.company, report.job.title, ...Object.values(((profile?.applyDefaults as ApplyDefaults | null) ?? {})).filter((v): v is string => Boolean(v))] })
    const [, row] = await this.prisma.$transaction([
      this.prisma.suggestion.deleteMany({ where: { reportId, kind: 'cover_letter', status: 'pending' } }),
      this.prisma.suggestion.create({ data: { reportId, kind: 'cover_letter', after: p.after ?? '', rationale: p.rationale, variant: p.variant ?? tone, grounding: g as unknown as Prisma.InputJsonValue, flagged: !g.ok } }),
    ])
    return row.id
  }

  /** The kit for one job: files, texts, questions + answers, ATS notes, and the existing application if any. */
  async kit(jobId: string, userId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { requirements: { select: { applicationQuestions: true } } } })
    if (!job) return null
    const applyUrl = job.applyUrl ?? job.sourceUrl
    const ats = detectApplyAts(applyUrl)
    const [tailored, master, profile, application] = await Promise.all([
      this.prisma.resumeVersion.findFirst({ where: { jobId, kind: 'tailored', renderStatus: 'rendered', resume: { userId } }, orderBy: { createdAt: 'desc' }, include: { reports: { where: { jobId }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, score: true } } } }),
      this.prisma.resume.findFirst({ where: { userId, isMaster: true }, select: { id: true, label: true, currentVersionId: true, sourceFileKey: true, sourceFilename: true } }),
      this.prisma.candidateProfile.findUnique({ where: { userId } }),
      this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId } }, include: { resumeVersionRef: { select: { id: true, kind: true, createdAt: true } } } }),
    ])
    const version = tailored ?? null
    const latestReport = await this.prisma.atsReport.findFirst({ where: { jobId, resumeVersion: { resume: { userId } } }, orderBy: { createdAt: 'desc' }, select: { id: true, score: true, resumeVersionId: true } })
    const answers = latestReport ? await this.prisma.suggestion.findMany({ where: { reportId: latestReport.id, kind: 'answer', status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } }) : []
    const cover = latestReport ? await this.prisma.suggestion.findFirst({ where: { reportId: latestReport.id, kind: 'cover_letter', status: { not: 'rejected' } }, orderBy: { createdAt: 'desc' } }) : null
    const content = version ? ResumeContentSchema.parse(version.content) : null
    const files = {
      pdf: version?.pdfKey ? await this.store.signedUrl(version.pdfKey, 600) : null,
      docx: version?.docxKey ? await this.store.signedUrl(version.docxKey, 600) : null,
      original: master?.sourceFileKey ? await this.store.signedUrl(master.sourceFileKey, 600) : null,
      originalName: master?.sourceFilename ?? null,
    }
    return {
      job: { id: job.id, title: job.title, company: job.company, applyUrl, ats, atsNote: ATS_NOTES[ats] },
      version: version ? { id: version.id, createdAt: version.createdAt, tailoredHeadline: version.tailoredHeadline, tailoredAbout: version.tailoredAbout, score: version.reports[0]?.score ?? null, reportId: version.reports[0]?.id ?? null } : null,
      masterVersionId: master?.currentVersionId ?? null,
      latestReport,
      texts: {
        headline: content?.basics.label ?? profile?.headline ?? null,
        about: content?.basics.summary ?? profile?.about ?? null,
        headlineIsTailored: Boolean(version?.tailoredHeadline),
        aboutIsTailored: Boolean(version?.tailoredAbout),
      },
      applyDefaults: (profile?.applyDefaults as ApplyDefaults | null) ?? {},
      questions: (job.requirements?.applicationQuestions as unknown as ApplicationQuestion[] | null) ?? [],
      answers: answers.map((a) => ({ id: a.id, question: a.question, answer: a.userEdit ?? a.after, status: a.status, flagged: a.flagged })),
      coverLetter: cover ? { id: cover.id, text: cover.userEdit ?? cover.after, status: cover.status, flagged: cover.flagged, tone: cover.variant } : null,
      files,
      application: application
        ? { id: application.id, status: application.status, appliedAt: application.appliedAt, followUpAt: application.followUpAt, coverNote: application.coverNote, resumeVersionId: application.resumeVersionId, headlineUsed: application.headlineUsed, aboutUsed: application.aboutUsed, submittedVia: application.submittedVia, events: application.events }
        : null,
    }
  }

  /** "Mark applied": records exactly what was sent; idempotent per (user, job). */
  async recordApplication(jobId: string, userId: string, input: RecordApplicationInput) {
    if (input.resumeVersionId) {
      const v = await this.prisma.resumeVersion.findFirst({ where: { id: input.resumeVersionId, resume: { userId } }, select: { id: true } })
      if (!v) throw new Error('Resume version not found')
    }
    const now = new Date()
    const status = input.status ?? 'applied'
    const existing = await this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId } } })
    const events = [...(((existing?.events as Array<Record<string, unknown>> | null) ?? [])), { at: now.toISOString(), type: status, note: input.note ?? null }]
    const data = {
      status,
      appliedAt: existing?.appliedAt ?? now,
      resumeVersionId: input.resumeVersionId ?? existing?.resumeVersionId ?? null,
      headlineUsed: input.headlineUsed ?? existing?.headlineUsed ?? null,
      aboutUsed: input.aboutUsed ?? existing?.aboutUsed ?? null,
      coverNote: input.coverNote ?? existing?.coverNote ?? null,
      answers: (input.answers ?? (existing?.answers as unknown as RecordApplicationInput['answers']) ?? null) as unknown as Prisma.InputJsonValue,
      submittedVia: input.submittedVia ?? existing?.submittedVia ?? 'manual',
      events: events as unknown as Prisma.InputJsonValue,
      ...(input.note ? { notes: input.note } : {}),
      ...(input.followUpAt !== undefined ? { followUpAt: input.followUpAt ? new Date(input.followUpAt) : null } : status === 'rejected' || status === 'withdrawn' || status === 'offer' ? { followUpAt: null } : {}),
    }
    const [application] = await this.prisma.$transaction([
      this.prisma.application.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId, ...data }, update: data }),
      this.prisma.jobUserState.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId, state: 'applied' }, update: { state: 'applied' } }),
    ])
    return application
  }
}
