/**
 * Extension API contract (simulated infra): pair → bearer-only access + CORS → kit resolved from the page URL
 * (exact URL / ATS job id / unknown) → file download with bearer → mark applied via the extension.
 *   tsx tools/testkit/run-tests.ts e2e-extension-api tools/sandbox-e2e/extension-api.test.ts
 */
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'

import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@jobradar/db'
import { NextRequest } from 'next/server'
import { setRequestContext } from 'next/headers'
import { POST as pairPOST, GET as pairGET, DELETE as pairDELETE } from '../../apps/web/app/api/ext/pair/route.js'
import { GET as meGET, OPTIONS as meOPTIONS } from '../../apps/web/app/api/ext/me/route.js'
import { GET as kitGET } from '../../apps/web/app/api/ext/apply-kit/route.js'
import { POST as appliedPOST } from '../../apps/web/app/api/ext/applied/route.js'
import { GET as filesGET } from '../../apps/web/app/api/files/route.js'
import { atsJobIdFromUrl } from '@jobradar/resume'

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
let token = ''
let jobId = ''
const bearer = (url: string, init: Record<string, unknown> = {}) => new NextRequest(url, { ...init, headers: { authorization: `Bearer ${token}`, origin: EXT, ...((init.headers as Record<string, string>) ?? {}) } }) as any

describe('E2E · browser-extension API', () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@sandbox.local', role: 'admin', lastLoginAt: new Date() } })
    await prisma.candidateProfile.create({ data: { userId: owner.id, headline: 'Senior Backend Engineer', about: 'I build things.', applyDefaults: { noticePeriod: '30 days', workAuthorization: 'Indian citizen, no sponsorship needed', linkedin: 'https://linkedin.com/in/me' } } })
    const resume = await prisma.resume.create({ data: { userId: owner.id, label: 'master', isMaster: true, sourceFileKey: `users/${owner.id}/resumes/r1/original.pdf`, sourceFilename: 'me.pdf', sourceMime: 'application/pdf', parseStatus: 'parsed' } })
    const v = await prisma.resumeVersion.create({ data: { resumeId: resume.id, contentHash: 'h', content: { basics: { name: 'Asha Verma', email: 'asha@example.com', phone: '+91 98765 43210', url: 'https://asha.dev', location: { city: 'Gurugram', countryCode: 'IN' }, profiles: [{ network: 'GitHub', url: 'https://github.com/asha' }] }, work: [{ name: 'Acme', position: 'Staff Engineer', startDate: '2021-01', highlights: [] }], education: [], skills: [], projects: [], certificates: [], languages: [], sections: [] } } })
    await prisma.resume.update({ where: { id: resume.id }, data: { currentVersionId: v.id } })
    const { services } = await import('../../apps/web/lib/services.js')
    await services().store.put(`users/${owner.id}/resumes/r1/original.pdf`, Buffer.from('%PDF-1.4 sandbox'), { contentType: 'application/pdf', filename: 'me.pdf' })
    const job = await prisma.job.create({ data: { title: 'Senior Backend Engineer', company: 'Acme', sourceName: 's', skills: '[]', canonicalHash: 'c1', applyUrl: 'https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc', applyUrlNormalized: 'https://boards.greenhouse.io/acme/jobs/4012345', status: 'new' } })
    jobId = job.id
    const report = await prisma.atsReport.create({ data: { resumeVersionId: v.id, jobId, scorerVersion: 'ats-v1', score: 80, breakdown: {} } })
    await prisma.suggestion.create({ data: { reportId: report.id, kind: 'answer', question: 'Why do you want to work at Acme?', after: 'Because payments at scale.', rationale: 'r', status: 'accepted' } })
    await prisma.suggestion.create({ data: { reportId: report.id, kind: 'cover_letter', after: 'Hiring team at Acme, …', rationale: 'r', status: 'pending' } })
  })

  it('1. pairing needs a session (cookie); the token is returned once and listed/revocable', async () => {
    const r = await pairPOST(new NextRequest('http://local/api/ext/pair', { method: 'POST', body: {} }) as any)
    expect(r.status).toBe(201)
    const body = await r.json()
    token = body.token
    expect(token.length).toBeGreaterThan(30)
    expect((await (await pairGET()).json()).data.length).toBe(1)
  })

  it('2. /api/ext/* is bearer-only with CORS for extension origins; preflight is 204', async () => {
    const pre = await meOPTIONS(new NextRequest('http://local/api/ext/me', { method: 'OPTIONS', headers: { origin: EXT } }) as any)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(EXT)
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/authorization/)
    const no = await meGET(new NextRequest('http://local/api/ext/me', { headers: { origin: EXT } }) as any)
    expect(no.status).toBe(401)
    const bad = await meGET(new NextRequest('http://local/api/ext/me', { headers: { authorization: 'Bearer nope', origin: 'https://evil.example' } }) as any)
    expect(bad.status).toBe(401)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull() // non-extension origin never gets CORS
    const ok = await meGET(bearer('http://local/api/ext/me'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).user.email).toBe('owner@sandbox.local')
    expect(ok.headers.get('access-control-allow-origin')).toBe(EXT)
  })

  it('3. kit resolves the job from the page URL: exact URL, ATS job id, and profile-only when unknown', async () => {
    const exact = await (await kitGET(bearer('http://local/api/ext/apply-kit?url=' + encodeURIComponent('https://boards.greenhouse.io/acme/jobs/4012345?utm_source=x#app')))).json()
    expect(exact.job).toMatchObject({ id: jobId, ats: 'greenhouse', matchedBy: 'url' })
    expect(exact.profile).toMatchObject({ firstName: 'Asha', lastName: 'Verma', email: 'asha@example.com', phone: '+91 98765 43210', linkedin: 'https://linkedin.com/in/me', github: 'https://github.com/asha', portfolio: 'https://asha.dev', currentCompany: 'Acme', currentTitle: 'Staff Engineer', headline: 'Senior Backend Engineer' })
    expect(exact.profile.applyDefaults.noticePeriod).toBe('30 days')
    expect(exact.resume).toMatchObject({ kind: 'master' })
    expect(exact.resume.original.filename).toBe('me.pdf')
    expect(exact.answers).toEqual([{ question: 'Why do you want to work at Acme?', answer: 'Because payments at scale.', flagged: false }])
    expect(exact.coverNote).toMatch(/^Hiring team/)
    const byId = await (await kitGET(bearer('http://local/api/ext/apply-kit?url=' + encodeURIComponent('https://job-boards.greenhouse.io/acme/jobs/4012345')))).json()
    expect(byId.job.matchedBy).toBe('ats_id')
    expect(atsJobIdFromUrl('https://jobs.lever.co/acme/2f1c9b2e-1234-4abc-9def-123456789abc/apply')).toEqual({ ats: 'lever', id: '2f1c9b2e-1234-4abc-9def-123456789abc' })
    const none = await (await kitGET(bearer('http://local/api/ext/apply-kit?url=' + encodeURIComponent('https://jobs.lever.co/other/2f1c9b2e-1234-4abc-9def-123456789abc')))).json()
    expect(none.job).toBeNull()
    expect(none.profile.fullName).toBe('Asha Verma') // profile-only fill still works
    expect(none.answers).toEqual([])
  })

  it('4. the signed file link is downloadable with the bearer token (no cookie)', async () => {
    const kit = await (await kitGET(bearer('http://local/api/ext/apply-kit?url=' + encodeURIComponent('https://boards.greenhouse.io/acme/jobs/4012345')))).json()
    const url = new URL(kit.resume.original.url, 'http://local')
    setRequestContext({ cookies: {}, headers: { authorization: `Bearer ${token}` } })
    const f = await filesGET(new NextRequest(url.toString(), { headers: { authorization: `Bearer ${token}`, origin: EXT } }) as any)
    expect(f.status).toBe(200)
    expect(f.headers.get('content-type')).toBe('application/pdf')
    expect(f.headers.get('access-control-allow-origin')).toBe(EXT)
    setRequestContext({ cookies: {}, headers: {} })
  })

  it('5. mark applied records submittedVia=extension with the artifacts used, and the kit reflects it', async () => {
    const r = await appliedPOST(bearer('http://local/api/ext/applied', { method: 'POST', body: { jobId, answers: [{ question: 'Why Acme?', answer: 'Payments.' }], coverNote: 'Hiring team at Acme, …', followUpInDays: 7 } }))
    expect(r.status).toBe(201)
    const app = await prisma.application.findFirst({ where: { jobId } })
    expect(app.submittedVia).toBe('extension')
    expect(app.followUpAt).toBeTruthy()
    expect(app.events.at(-1).note).toMatch(/browser extension/)
    const kit = await (await kitGET(bearer('http://local/api/ext/apply-kit?url=' + encodeURIComponent('https://boards.greenhouse.io/acme/jobs/4012345')))).json()
    expect(kit.application.status).toBe('applied')
  })

  it('6. revoking the token locks the extension out', async () => {
    await pairDELETE(new NextRequest('http://local/api/ext/pair', { method: 'DELETE', body: {} }) as any)
    expect((await meGET(bearer('http://local/api/ext/me'))).status).toBe(401)
  })
})
