/**
 * E2E (simulated infra): visual resume editor — save a draft as a tailored version through the real route,
 * render it with the inline runner (simple PDF + DOCX), verify, re-score, and see it in the Apply Kit;
 * then a master correction without a job.
 *   tsx tools/testkit/run-tests.ts e2e-editor tools/sandbox-e2e/editor.test.ts
 */
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'
process.env.PDF_RENDERER = 'simple'

import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@jobradar/db'
import { NextRequest } from 'next/server'
import { ResumeContentSchema, analyzeJdDeterministic, scoreResume, diffContent, extractDocument } from '@jobradar/resume'
import { SAMPLE_RESUME, SAMPLE_JD, SAMPLE_JD_TITLE } from '../../packages/resume/src/__fixtures__/sample.js'
import { POST as versionsPOST } from '../../apps/web/app/api/resume-versions/route.js'
import { GET as versionGET } from '../../apps/web/app/api/resume-versions/[id]/route.js'
import { GET as kitGET } from '../../apps/web/app/api/jobs/[id]/apply-kit/route.js'
import { GET as taskGET } from '../../apps/web/app/api/tasks/[id]/route.js'
import { PATCH as suggestionPATCH } from '../../apps/web/app/api/suggestions/[id]/route.js'

const base = ResumeContentSchema.parse(SAMPLE_RESUME)
const reqs = analyzeJdDeterministic(SAMPLE_JD_TITLE, SAMPLE_JD)
let owner: { id: string }, resume: { id: string }, masterVersion: { id: string }, job: { id: string }, suggestionId = ''
const json = async (r: any) => r.json()
const waitTask = async (id: string) => { for (let i = 0; i < 50; i++) { const t = await json(await taskGET(new NextRequest(`http://local/api/tasks/${id}`) as any, { params: Promise.resolve({ id }) })); if (t.status === 'done' || t.status === 'failed') return t; await new Promise((r) => setTimeout(r, 100)) } throw new Error('task timeout') }

describe('E2E · visual resume editor', () => {
  beforeAll(async () => {
    owner = await prisma.user.create({ data: { email: 'owner@sandbox.local', role: 'admin', lastLoginAt: new Date() } })
    await prisma.candidateProfile.create({ data: { userId: owner.id, confirmedFacts: ['Used Terraform for AWS infrastructure at Acme'] } })
    resume = await prisma.resume.create({ data: { userId: owner.id, label: 'master', isMaster: true, parseStatus: 'parsed', parseWarnings: [] } })
    masterVersion = await prisma.resumeVersion.create({ data: { resumeId: resume.id, kind: 'master', content: base, contentHash: 'h0' } })
    await prisma.resume.update({ where: { id: resume.id }, data: { currentVersionId: masterVersion.id } })
    job = await prisma.job.create({ data: { title: SAMPLE_JD_TITLE, company: 'Acme', sourceName: 's', skills: '[]', canonicalHash: 'c1', description: SAMPLE_JD, status: 'new', applyUrl: 'https://boards.greenhouse.io/acme/jobs/4012345' } })
    await prisma.jobRequirements.create({ data: { jobId: job.id, descriptionHash: 'd', extractorVersion: reqs.extractorVersion, required: reqs.required, preferred: reqs.preferred, keywords: reqs.keywords, titleNormalized: reqs.titleNormalized, seniority: reqs.seniority, yearsMin: reqs.yearsMin, llmUsed: false } })
    const report = await prisma.atsReport.create({ data: { resumeVersionId: masterVersion.id, jobId: job.id, scorerVersion: 'ats-v1', score: scoreResume(base, reqs).score, breakdown: scoreResume(base, reqs) } })
    const missing = scoreResume(base, reqs).missing.find((m) => m.required)!
    const s = await prisma.suggestion.create({ data: { reportId: report.id, kind: 'skills_section', after: missing.skill, rationale: `JD requires ${missing.skill}`, status: 'pending' } })
    suggestionId = s.id
  })

  it('1. the same scorer runs in the editor: a draft that adds the missing skill scores higher before anything is saved', async () => {
    const before = scoreResume(base, reqs)
    const draft = structuredClone(base)
    draft.skills[0].keywords.push(before.missing.find((m) => m.required)!.skill)
    expect(scoreResume(draft, reqs).score).toBeGreaterThan(before.score)
  })

  it('2. save the draft as a tailored version: change log + grounding flags stored, suggestion accepted, render + re-score run', async () => {
    const draft = structuredClone(base)
    const missing = scoreResume(base, reqs).missing.find((m) => m.required)!.skill
    draft.skills[0].keywords.push(missing)                                   // applied suggestion
    draft.basics.label = 'Senior Backend Engineer · Go, Kubernetes, Kafka'    // headline edit
    draft.work[0].highlights[0] = 'Built a Rust sidecar for 12 million daily payments at Stripe' // ungrounded claim
    draft.work[0].highlights.push('Used Terraform for AWS infrastructure at Acme')                 // confirmed fact → grounded
    await suggestionPATCH(new NextRequest(`http://local/api/suggestions/${suggestionId}`, { method: 'PATCH', body: { status: 'accepted' } }) as any, { params: Promise.resolve({ id: suggestionId }) })
    const res = await versionsPOST(new NextRequest('http://local/api/resume-versions', { method: 'POST', body: { baseVersionId: masterVersion.id, jobId: job.id, content: draft, acceptedSuggestionIds: [suggestionId], note: 'editor e2e' } }) as any)
    expect(res.status).toBe(202)
    const body = await json(res)
    expect(body.kind).toBe('tailored')
    expect(body.changes).toBe(3) // label · skills keywords · the highlights list (edited + appended → one change)
    // both the invented bullet and the skill the master never evidenced are flagged (stored, not blocking)
    expect(body.grounding.map((g: any) => g.path).sort()).toEqual(['/skills/0/keywords', '/work/0/highlights'])
    expect(body.grounding.find((g: any) => g.path === '/work/0/highlights').unsupported.map((u: any) => u.value)).toEqual(expect.arrayContaining(['Rust', '12'])) // invented tool + invented metric
    const t = await waitTask(body.taskId)
    expect(t.status).toBe('done')
    const v = await json(await versionGET(new NextRequest(`http://local/api/resume-versions/${body.versionId}`) as any, { params: Promise.resolve({ id: body.versionId }) }))
    expect(v.kind).toBe('tailored')
    expect(v.parentId).toBe(masterVersion.id)
    expect(v.renderStatus).toBe('rendered')
    expect(v.pdfKey).toMatch(/resume\.pdf$/)
    expect(v.docxKey).toMatch(/resume\.docx$/)
    expect(v.tailoredHeadline).toBe(true)
    expect(v.changeLog.editor).toBe(true)
    expect(v.changeLog.note).toBe('editor e2e')
    expect(v.changeLog.acceptedSuggestionIds).toEqual([suggestionId])
    expect(typeof v.changeLog.scoreBefore).toBe('number')
    expect(v.changeLog.scoreAfter).toBeGreaterThan(v.changeLog.scoreBefore)
    expect(diffContent(base, v.content).length).toBe(3)
    // the rendered PDF is real and parses back to the edited headline
    const { services } = await import('../../apps/web/lib/services.js')
    const pdf = await services().store.get(v.pdfKey)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    const text = (await extractDocument(pdf, 'pdf')).text
    expect(text).toContain('Senior Backend Engineer')
    expect(text).toContain(missing)
    // a new report exists for the version
    const reports = await prisma.atsReport.count({ where: { resumeVersionId: body.versionId, jobId: job.id } })
    expect(reports).toBe(1)
    // the Apply Kit now offers the tailored version
    const kit = await json(await kitGET(new NextRequest(`http://local/api/jobs/${job.id}/apply-kit`) as any, { params: Promise.resolve({ id: job.id }) }))
    expect(kit.version.id).toBe(body.versionId)
    expect(kit.texts.headline).toBe('Senior Backend Engineer · Go, Kubernetes, Kafka')
    expect(kit.texts.headlineIsTailored).toBe(true)
    // the master is untouched
    const master = await prisma.resumeVersion.findUnique({ where: { id: masterVersion.id } })
    expect(master.content.basics.label).toBe(base.basics.label)
    expect((await prisma.resume.findUnique({ where: { id: resume.id } })).currentVersionId).toBe(masterVersion.id)
  })

  it('3. without a job: the draft becomes a correction and the resume\'s current version', async () => {
    const draft = structuredClone(base)
    draft.basics.summary = (base.basics.summary ?? '') + ' Mentors engineers.'
    const res = await versionsPOST(new NextRequest('http://local/api/resume-versions', { method: 'POST', body: { baseVersionId: masterVersion.id, content: draft } }) as any)
    expect(res.status).toBe(202)
    const body = await json(res)
    expect(body.kind).toBe('correction')
    expect(body.grounding).toEqual([])
    await waitTask(body.taskId)
    expect((await prisma.resume.findUnique({ where: { id: resume.id } })).currentVersionId).toBe(body.versionId)
    expect((await prisma.resumeVersion.findUnique({ where: { id: body.versionId } })).renderStatus).toBe('rendered')
  })

  it('4. validation: unchanged draft, foreign suggestion and a schema violation are rejected', async () => {
    const same = await versionsPOST(new NextRequest('http://local/api/resume-versions', { method: 'POST', body: { baseVersionId: masterVersion.id, jobId: job.id, content: base } }) as any)
    expect(same.status).toBe(400)
    expect((await json(same)).error).toMatch(/No changes/)
    const bad = await versionsPOST(new NextRequest('http://local/api/resume-versions', { method: 'POST', body: { baseVersionId: masterVersion.id, jobId: job.id, content: { basics: 5 } } }) as any)
    expect(bad.status).toBe(400)
    const other = await prisma.user.create({ data: { email: 'x@y' } })
    const r2 = await prisma.resume.create({ data: { userId: other.id, label: 'o' } })
    const v2 = await prisma.resumeVersion.create({ data: { resumeId: r2.id, content: base, contentHash: 'z' } })
    const rep2 = await prisma.atsReport.create({ data: { resumeVersionId: v2.id, jobId: job.id, scorerVersion: 'ats-v1', score: 1, breakdown: {} } })
    const foreign = await prisma.suggestion.create({ data: { reportId: rep2.id, kind: 'skills_section', after: 'X', rationale: 'r' } })
    const draft = structuredClone(base); draft.basics.name = 'Changed'
    const stolen = await versionsPOST(new NextRequest('http://local/api/resume-versions', { method: 'POST', body: { baseVersionId: masterVersion.id, jobId: job.id, content: draft, acceptedSuggestionIds: [foreign.id] } }) as any)
    expect(stolen.status).toBe(400)
    expect((await json(stolen)).error).toMatch(/do not belong/)
  })
})
