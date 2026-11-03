import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeLlmProvider } from '@jobradar/llm'
import { LocalFsStore } from '@jobradar/storage'
import { makePdf, column } from '../../../../tools/testkit/pdf'
import { SAMPLE_JD, SAMPLE_JD_TITLE, SAMPLE_RESUME, SAMPLE_RESUME_TEXT } from '../__fixtures__/sample.js'
import { ResumeService } from './resume.service.js'
import { AnalysisService, NeedsManualJdError } from './analysis.service.js'

/**
 * Runs against a real Postgres (the v3 migration must be applied): DATABASE_URL=postgresql://… vitest run.
 * Skipped otherwise. Exercises: upload → parse (fake LLM) → master version → profile seed → requirements →
 * score → report; manual-JD fallback; correction versions; user scoping; delete cascade.
 */
const DB = process.env.DATABASE_URL
describe.skipIf(!DB)('resume + analysis services (Postgres)', () => {
  let prisma: import('@jobradar/db').PrismaClient
  let dir: string
  let store: LocalFsStore
  let userId: string
  let otherUserId: string
  let jobId: string
  let emptyJobId: string
  const llm = new FakeLlmProvider()
    .on('parse_resume', () => ({ ...SAMPLE_RESUME, basics: { ...SAMPLE_RESUME.basics, email: '[EMAIL_1]', phone: '[PHONE_1]', url: '[URL_1]' } }))
    .on('analyze_jd', () => ({ required: [{ skill: 'Temporal', weight: 0.9 }], preferred: [], keywords: [{ term: 'payments', weight: 0.8 }], yearsMin: null, seniority: null, titleNormalized: null }))

  beforeAll(async () => {
    const { prisma: p } = await import('@jobradar/db')
    prisma = p
    dir = await mkdtemp(join(tmpdir(), 'jr-int-'))
    store = new LocalFsStore({ root: dir, signingSecret: 'integration-secret-0123456789' })
    const tag = Date.now()
    userId = (await prisma.user.create({ data: { email: `int-${tag}@test.local` } })).id
    otherUserId = (await prisma.user.create({ data: { email: `int-other-${tag}@test.local` } })).id
    jobId = (await prisma.job.create({ data: { title: SAMPLE_JD_TITLE, company: 'Acme', sourceName: 'test', skills: '["Engineering"]', description: SAMPLE_JD, canonicalHash: `h-${tag}` } })).id
    emptyJobId = (await prisma.job.create({ data: { title: 'Mystery Role', company: 'Nowhere', sourceName: 'test', skills: '[]', description: '', canonicalHash: `h2-${tag}`, applyUrl: null, sourceUrl: null } })).id
  })
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: [jobId, emptyJobId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
    await prisma.$disconnect()
    await rm(dir, { recursive: true, force: true })
  })

  it('upload → parse → master version, profile seeded, PII restored', async () => {
    const svc = new ResumeService(prisma, store)
    const pdf = makePdf([{ texts: column(SAMPLE_RESUME_TEXT.split('\n'), 60, 760, 12, 8) }])
    const resume = await svc.createFromUpload({ userId, buffer: pdf, filename: 'jane.pdf' })
    expect(resume.isMaster).toBe(true)
    expect(resume.sourceFileKey).toMatch(new RegExp(`^users/${userId}/resumes/${resume.id}/original.pdf$`))

    const progress: string[] = []
    const r = await svc.parse(resume.id, llm, (m) => { progress.push(m) })
    expect(progress).toEqual(['Extracting text', 'Structuring with AI'])
    expect(r.resume.parseStatus).toBe('parsed')
    expect(r.warnings).toEqual([])
    expect(r.version.kind).toBe('master')
    const content = r.version.content as typeof SAMPLE_RESUME
    expect(content.basics.email).toBe('jane.doe@example.com')
    expect(content.basics.phone).toBe('+91 98765 43210')

    const profile = await prisma.candidateProfile.findUnique({ where: { userId } })
    expect(profile?.headline).toBe('Senior Software Engineer')
    expect((profile?.skills as Array<{ canonical: string }>).map((s) => s.canonical)).toContain('Kubernetes')

    // user scoping
    expect(await svc.get(resume.id, otherUserId)).toBeNull()
    expect(await svc.originalUrl(resume.id, userId)).toMatch(/^\/api\/files\?key=/)

    // correction creates a new immutable version and becomes current
    const corrected = await svc.correct(resume.id, userId, { ...content, basics: { ...content.basics, label: 'Senior Backend Engineer' } })
    const d = await svc.get(resume.id, userId)
    expect(d?.current?.id).toBe(corrected.id)
    expect(d?.versions.map((v) => v.kind)).toEqual(['correction', 'master'])
    const original = await prisma.resumeVersion.findUnique({ where: { id: r.version.id } })
    expect((original!.content as typeof SAMPLE_RESUME).basics.label).toBe('Senior Software Engineer') // untouched
  })

  it('requirements are cached per description hash, job.skills gets real skills, score report is stored', async () => {
    const analysis = new AnalysisService(prisma, { llm, hydrator: null })
    const a = await analysis.ensureRequirements(jobId, { userId })
    expect(a.cached).toBe(false)
    expect(a.requirements.llmUsed).toBe(true)
    expect(a.requirements.required.map((x) => x.skill)).toContain('Temporal')
    expect(JSON.parse(a.job.skills)).toContain('Go')
    const b = await analysis.ensureRequirements(jobId, { userId })
    expect(b.cached).toBe(true)
    expect(llm.calls.filter((c) => c.purpose === 'analyze_jd')).toHaveLength(1)

    const resume = await prisma.resume.findFirstOrThrow({ where: { userId, isMaster: true } })
    const s = await analysis.score(resume.currentVersionId!, jobId, userId)
    expect(s.breakdown.score).toBeGreaterThan(60)
    expect(s.breakdown.keywordsMatched).toContain('payments')
    const report = await analysis.getReport(s.reportId, userId)
    expect(report?.job.title).toBe(SAMPLE_JD_TITLE)
    expect(report?.requirements?.required.length).toBeGreaterThan(5)
    expect(await analysis.getReport(s.reportId, otherUserId)).toBeNull()

    // re-score upserts (unique per version+job+scorer)
    const s2 = await analysis.score(resume.currentVersionId!, jobId, userId)
    expect(s2.reportId).toBe(s.reportId)
    // other user cannot score my version
    await expect(analysis.score(resume.currentVersionId!, jobId, otherUserId)).rejects.toThrow(/not found/)
  })

  it('empty description without a hydrator → needs_manual_jd; pasted JD unblocks', async () => {
    const analysis = new AnalysisService(prisma, { llm, hydrator: { hydrate: async () => null } })
    await expect(analysis.ensureRequirements(emptyJobId, { userId })).rejects.toBeInstanceOf(NeedsManualJdError)
    const reqs = await analysis.setManualDescription(emptyJobId, SAMPLE_JD, userId)
    expect(reqs.required.length).toBeGreaterThan(5)
    expect((await prisma.jobRequirements.findUnique({ where: { jobId: emptyJobId } }))?.descriptionSource).toBe('manual')
    // audit NEW-03: the crawled column is untouched; the paste lives beside it with provenance
    const row = await prisma.job.findUnique({ where: { id: emptyJobId } })
    expect(row?.description ?? '').not.toBe(SAMPLE_JD)
    expect(row?.descriptionManual).toBe(SAMPLE_JD)
    expect(row?.descriptionManualBy).toBe(userId)
    // and a job that already has a usable description refuses a paste
    await expect(analysis.setManualDescription(jobId, SAMPLE_JD, userId)).rejects.toThrow(/already has a description/)
  })

  it('hydrator result is stored on the job and used', async () => {
    const hydrated = await prisma.job.create({ data: { title: 'Go Engineer', company: 'H', sourceName: 'test', skills: '[]', description: 'short', canonicalHash: `h3-${Date.now()}` } })
    try {
      const analysis = new AnalysisService(prisma, { llm: null, hydrator: { hydrate: async () => ({ description: SAMPLE_JD, source: 'hydrated' }) } })
      const r = await analysis.ensureRequirements(hydrated.id)
      expect(r.job.description).toBe(SAMPLE_JD)
      expect((await prisma.jobRequirements.findUnique({ where: { jobId: hydrated.id } }))?.descriptionSource).toBe('hydrated')
      expect(r.requirements.llmUsed).toBe(false)
    } finally {
      await prisma.job.delete({ where: { id: hydrated.id } })
    }
  })

  it('delete removes files and cascades versions/reports', async () => {
    const svc = new ResumeService(prisma, store)
    const resume = await prisma.resume.findFirstOrThrow({ where: { userId } })
    expect(await store.head(resume.sourceFileKey!)).not.toBeNull()
    expect(await svc.delete(resume.id, otherUserId)).toBe(false)
    expect(await svc.delete(resume.id, userId)).toBe(true)
    expect(await store.head(resume.sourceFileKey!)).toBeNull()
    expect(await prisma.resumeVersion.count({ where: { resumeId: resume.id } })).toBe(0)
    expect(await prisma.atsReport.count({ where: { jobId } })).toBe(0)
  })
})
