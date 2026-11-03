import { beforeEach, describe, expect, it } from 'vitest'
import { FetchGateway } from '@jobradar/crawler'
import { createFakePrisma } from '../../../tools/testkit/fake-prisma.js'
import { FakeRedis } from '../../../tools/testkit/fake-redis.js'
import { FakeFetch } from '../../../tools/testkit/fake-fetch.js'
import { JdHydrationService, externalIdFromUrl, extractMainText } from './jd-hydration.service.js'

const LONG = 'We are hiring. '.repeat(30)
let http: FakeFetch, svc: JdHydrationService, prisma: any
beforeEach(async () => {
  prisma = createFakePrisma()
  await prisma.hostPolicy.create({ data: { host: '*', minIntervalMs: 10, burst: 5, maxConcurrency: 2, dailyBudget: 1000, probeBudgetPerDay: 10, respectRobots: false } })
  http = new FakeFetch().install()
  svc = new JdHydrationService(prisma, new FetchGateway(prisma, new FakeRedis() as any))
})
const job = (o: Record<string, unknown>) => ({ id: 'j', title: 'Eng', company: 'Acme', description: '', applyUrl: null, sourceUrl: null, ...o }) as any

describe('JdHydrationService', () => {
  it('greenhouse apply URL → detail API (entity-escaped content decoded)', async () => {
    http.route(/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs\/123/, { status: 200, body: { id: 123, content: `&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;${LONG}&lt;/li&gt;&lt;/ul&gt;` } })
    const r = await svc.hydrate(job({ applyUrl: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=x' }))
    expect(r?.via).toBe('ats_api')
    expect(r?.description).toContain('# Requirements')
    expect(r?.description).not.toContain('<')
  })
  it('lever → single posting endpoint; ashby → list lookup by id', async () => {
    const id = '11111111-2222-3333-4444-555555555555'
    http.route(/api\.lever\.co\/v0\/postings\/acme\/1111/, { status: 200, body: { descriptionPlain: LONG, lists: [{ text: 'Requirements', content: '<li>Go</li>' }] } })
    const lever = await svc.hydrate(job({ applyUrl: `https://jobs.lever.co/acme/${id}` }))
    expect(lever?.description).toContain('# Requirements')
    http.route(/api\.ashbyhq\.com\/posting-api\/job-board\/acme/, { status: 200, body: { jobs: [{ id, jobUrl: `https://jobs.ashbyhq.com/acme/${id}`, descriptionPlain: LONG }] } })
    const ashby = await svc.hydrate(job({ applyUrl: `https://jobs.ashbyhq.com/acme/${id}` }))
    expect(ashby?.description.length).toBeGreaterThan(200)
  })
  it('non-ATS URL → HTML main-content extraction through the gateway; nothing usable → null', async () => {
    http.route('https://jobs.example.com/123', { status: 200, headers: { 'content-type': 'text/html' }, body: `<html><body><nav>Home Jobs</nav><main><h1>Eng</h1><p>${LONG}</p></main><footer>© Example</footer></body></html>` })
    const r = await svc.hydrate(job({ applyUrl: 'https://jobs.example.com/123' }))
    expect(r?.via).toBe('html')
    expect(r?.description).not.toContain('Home Jobs')
    expect(http.requests[0].headers['user-agent']).toMatch(/JobRadar/)
    http.route('https://jobs.example.com/gone', { status: 404, body: 'nope' })
    expect(await svc.hydrate(job({ applyUrl: 'https://jobs.example.com/gone' }))).toBeNull()
    expect(await svc.hydrate(job({}))).toBeNull()
  })
  it('helpers', () => {
    expect(externalIdFromUrl('greenhouse', 'https://boards.greenhouse.io/acme/jobs/4567?x=1')).toBe('4567')
    expect(externalIdFromUrl('workable', 'https://apply.workable.com/acme/j/AB12CD/')).toBe('AB12CD')
    expect(externalIdFromUrl('smartrecruiters', 'https://jobs.smartrecruiters.com/Acme/743999912345678-backend')).toBe('743999912345678')
    expect(extractMainText('<div class="job-description"><p>Alpha</p></div><footer>Cookie policy</footer>')).toBe('Alpha')
  })
})
