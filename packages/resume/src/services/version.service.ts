import type { Prisma, PrismaClient, ResumeVersion } from '@jobradar/db'
import type { ObjectStore } from '@jobradar/storage'
import { extractDocument } from '../parse/extract.js'
import { checkParseability, type ParseWarning } from '../parse/parseability.js'
import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { renderAtsClassicHtml, TEMPLATE_VERSION } from '../render/template-ats-classic.js'
import { renderAtsClassicDocx } from '../render/docx.js'
import type { PdfRenderer } from '../render/pdf.js'
import { renderSimplePdf } from '../render/simple-pdf.js'
import { buildTailoredContent } from '../version/create.js'
import { diffContent, groundChanges } from '../version/editor.js'
import { contentHash } from './resume.service.js'
import type { AnalysisService } from './analysis.service.js'
import { log, m } from '@jobradar/log'

export interface CreateTailoredInput {
  userId: string
  baseVersionId: string
  jobId: string
  acceptedSuggestionIds: string[]
  headline?: string | null
  about?: string | null
  template?: string
}

export interface CreateFromEditorInput {
  userId: string
  baseVersionId: string
  /** With a job → tailored version for it; without → a correction that becomes the resume's current version. */
  jobId?: string | null
  content: unknown
  acceptedSuggestionIds?: string[]
  note?: string | null
  template?: string
}

export interface RenderDeps {
  /** Chromium renderer (null = use the dependency-free simple renderer). */
  pdf: PdfRenderer | null
  analysis: AnalysisService
  /** 'chromium' (default when pdf is set) | 'simple'. Chromium failures fall back to simple automatically. */
  renderer?: 'chromium' | 'simple'
}

export class VersionService {
  constructor(private prisma: PrismaClient, private store: ObjectStore, private deps: RenderDeps) {}

  /** C9-1: immutable tailored version from base + accepted suggestions (+ optional per-application headline/about). */
  async createTailored(input: CreateTailoredInput): Promise<ResumeVersion> {
    const base = await this.prisma.resumeVersion.findUnique({ where: { id: input.baseVersionId }, include: { resume: { select: { userId: true, id: true } } } })
    if (!base || base.resume.userId !== input.userId) throw new Error('Base version not found')
    const job = await this.prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true } })
    if (!job) throw new Error('Job not found')
    const accepted = input.acceptedSuggestionIds.length
      ? await this.prisma.suggestion.findMany({
          where: { id: { in: input.acceptedSuggestionIds }, status: { in: ['accepted', 'edited'] }, report: { jobId: input.jobId, resumeVersion: { resume: { userId: input.userId } } } },
        })
      : []
    if (accepted.length !== new Set(input.acceptedSuggestionIds).size) throw new Error('Some suggestions are not accepted or do not belong to this job')

    const { content, changes } = buildTailoredContent({ base: ResumeContentSchema.parse(base.content), accepted, headline: input.headline ?? undefined, about: input.about ?? undefined })
    const parentReport = await this.prisma.atsReport.findFirst({ where: { resumeVersionId: base.id, jobId: input.jobId }, orderBy: { createdAt: 'desc' }, select: { score: true } })
    return this.prisma.resumeVersion.create({
      data: {
        resumeId: base.resume.id,
        parentId: base.id,
        jobId: input.jobId,
        kind: 'tailored',
        content: content as unknown as Prisma.InputJsonValue,
        contentHash: contentHash(content),
        template: input.template ?? 'ats-classic',
        renderStatus: 'pending',
        tailoredHeadline: input.headline != null,
        tailoredAbout: input.about != null,
        changeLog: { changes, scoreBefore: parentReport?.score ?? null, templateVersion: TEMPLATE_VERSION } as unknown as Prisma.InputJsonValue,
      },
    })
  }

  /**
   * Visual editor save (docs/HLD-resume-editor.md §3): the draft is validated, diffed against the base for an
   * attributable change log, and every changed string is grounding-checked against the MASTER version +
   * confirmed facts (flags are stored, never block — the user's own words are theirs). Immutable like every
   * other version; with a job it is a tailored version, otherwise a correction that becomes current.
   */
  async createFromEditor(input: CreateFromEditorInput): Promise<ResumeVersion> {
    const base = await this.prisma.resumeVersion.findUnique({ where: { id: input.baseVersionId }, include: { resume: { select: { userId: true, id: true, isMaster: true, currentVersionId: true } } } })
    if (!base || base.resume.userId !== input.userId) throw new Error('Base version not found')
    if (input.jobId && !(await this.prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true } }))) throw new Error('Job not found')
    const content = ResumeContentSchema.parse(input.content)
    const baseContent = ResumeContentSchema.parse(base.content)
    const changes = diffContent(baseContent, content)
    if (!changes.length) throw new Error('No changes to save')
    // master = the resume's current (non-tailored) content; confirmed facts from the profile
    const masterRow = base.resume.currentVersionId ? await this.prisma.resumeVersion.findUnique({ where: { id: base.resume.currentVersionId } }) : null
    const master = masterRow && masterRow.kind !== 'tailored' ? ResumeContentSchema.parse(masterRow.content) : baseContent
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId: input.userId }, select: { confirmedFacts: true } })
    const grounding = groundChanges(changes, master, ((profile?.confirmedFacts as string[] | null) ?? []).filter((f) => typeof f === 'string'))
    const acceptedIds = [...new Set(input.acceptedSuggestionIds ?? [])]
    if (acceptedIds.length) {
      const n = await this.prisma.suggestion.count({ where: { id: { in: acceptedIds }, report: { resumeVersion: { resume: { userId: input.userId } } } } })
      if (n !== acceptedIds.length) throw new Error('Some suggestions do not belong to you')
    }
    const parentReport = input.jobId ? await this.prisma.atsReport.findFirst({ where: { resumeVersionId: base.id, jobId: input.jobId }, orderBy: { createdAt: 'desc' }, select: { score: true } }) : null
    const version = await this.prisma.resumeVersion.create({
      data: {
        resumeId: base.resume.id,
        parentId: base.id,
        jobId: input.jobId ?? null,
        kind: input.jobId ? 'tailored' : 'correction',
        content: content as unknown as Prisma.InputJsonValue,
        contentHash: contentHash(content),
        template: input.template ?? 'ats-classic',
        renderStatus: 'pending',
        tailoredHeadline: Boolean(input.jobId) && changes.some((c) => c.path === '/basics/label'),
        tailoredAbout: Boolean(input.jobId) && changes.some((c) => c.path === '/basics/summary'),
        changeLog: { editor: true, note: input.note?.slice(0, 200) ?? null, changes, grounding: grounding.map((g) => ({ path: g.path, unsupported: g.result.unsupported })), acceptedSuggestionIds: acceptedIds, scoreBefore: parentReport?.score ?? null, templateVersion: TEMPLATE_VERSION } as unknown as Prisma.InputJsonValue,
      },
    })
    if (!input.jobId) {
      await this.prisma.resume.update({ where: { id: base.resume.id }, data: { currentVersionId: version.id } })
    }
    log.info('editor version created', { userId: input.userId, versionId: version.id, jobId: input.jobId ?? null, changes: changes.length, grounded: grounding.length })
    return version
  }

  /** C9-2..4: render PDF + DOCX, verify the PDF parses cleanly, store, re-score. */
  async render(versionId: string, userId: string, onProgress?: (m: string) => Promise<void> | void): Promise<{ version: ResumeVersion; warnings: ParseWarning[]; scoreAfter: number | null }> {
    const v = await this.prisma.resumeVersion.findUnique({ where: { id: versionId }, include: { resume: { select: { userId: true } } } })
    if (!v || v.resume.userId !== userId) throw new Error('Version not found')
    await this.prisma.resumeVersion.update({ where: { id: versionId }, data: { renderStatus: 'pending', renderError: null } })
    try {
      const content = ResumeContentSchema.parse(v.content)
      await onProgress?.('Rendering PDF')
      let pdf: Buffer
      let rendererUsed: 'chromium' | 'simple' = 'simple'
      if (this.deps.pdf && this.deps.renderer !== 'simple') {
        try {
          pdf = await this.deps.pdf.htmlToPdf(renderAtsClassicHtml(content))
          rendererUsed = 'chromium'
        } catch (err) {
          log.warn('[render] Chromium renderer failed, using simple renderer:', (err as Error).message)
          pdf = renderSimplePdf(content)
        }
      } else {
        pdf = renderSimplePdf(content)
      }
      await onProgress?.('Rendering DOCX')
      const docx = await renderAtsClassicDocx(content)

      await onProgress?.('Verifying the PDF parses')
      const extracted = await extractDocument(pdf, 'pdf')
      const warnings = checkParseability(extracted)
      const fatal = warnings.filter((w) => w.severity === 'error')
      if (fatal.length) throw new Error(`Rendered PDF failed verification: ${fatal.map((w) => w.code).join(', ')}`)

      const base = `users/${userId}/resumes/${v.resumeId}/versions/${v.id}`
      const safeName = (content.basics.name || 'resume').replace(/[^\w.-]+/g, '_').slice(0, 40)
      await this.store.put(`${base}/resume.pdf`, pdf, { contentType: 'application/pdf', filename: `${safeName}.pdf` })
      await this.store.put(`${base}/resume.docx`, docx, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `${safeName}.docx` })

      let version = await this.prisma.resumeVersion.update({
        where: { id: versionId },
        data: { pdfKey: `${base}/resume.pdf`, docxKey: `${base}/resume.docx`, renderStatus: 'rendered', renderedAt: new Date(), renderWarnings: warnings as unknown as Prisma.InputJsonValue, changeLog: { ...((v.changeLog as Record<string, unknown> | null) ?? {}), renderer: rendererUsed } as unknown as Prisma.InputJsonValue },
      })
      m.renders.inc({ renderer: rendererUsed, outcome: warnings.length ? 'rendered_with_warnings' : 'rendered' })
      let scoreAfter: number | null = null
      if (v.jobId) {
        await onProgress?.('Re-scoring')
        const r = await this.deps.analysis.score(versionId, v.jobId, userId)
        scoreAfter = r.breakdown.score
        const changeLog = (version.changeLog as Record<string, unknown> | null) ?? {}
        version = await this.prisma.resumeVersion.update({ where: { id: versionId }, data: { changeLog: { ...changeLog, scoreAfter, reportId: r.reportId } as unknown as Prisma.InputJsonValue } })
      }
      return { version, warnings, scoreAfter }
    } catch (err) {
      m.renders.inc({ renderer: this.deps.renderer ?? 'chromium', outcome: 'failed' })
      await this.prisma.resumeVersion.update({ where: { id: versionId }, data: { renderStatus: 'failed', renderError: (err as Error).message.slice(0, 500) } })
      throw err
    }
  }

  async get(versionId: string, userId: string) {
    const v = await this.prisma.resumeVersion.findUnique({ where: { id: versionId }, include: { resume: { select: { userId: true, label: true } }, job: { select: { id: true, title: true, company: true } }, reports: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, score: true, scorerVersion: true } } } })
    if (!v || v.resume.userId !== userId) return null
    return v
  }

  async fileUrl(versionId: string, userId: string, fmt: 'pdf' | 'docx'): Promise<string | null> {
    const v = await this.get(versionId, userId)
    const key = fmt === 'pdf' ? v?.pdfKey : v?.docxKey
    return key ? this.store.signedUrl(key, 600) : null
  }

  /** Preview HTML (same template) for the UI. */
  async previewHtml(versionId: string, userId: string): Promise<string | null> {
    const v = await this.get(versionId, userId)
    return v ? renderAtsClassicHtml(ResumeContentSchema.parse(v.content)) : null
  }

  contentOf(v: ResumeVersion): ResumeContent {
    return ResumeContentSchema.parse(v.content)
  }
}
