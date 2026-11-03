import { describe, expect, it, beforeEach } from 'vitest'
import { engineFor, supportedAts } from './registry.js'
import { FetchGateway } from '../gateway/fetch-gateway.js'
import { createFakePrisma } from '../../../../tools/testkit/fake-prisma.js'
import { FakeRedis } from '../../../../tools/testkit/fake-redis.js'
import { FakeFetch } from '../../../../tools/testkit/fake-fetch.js'
import type { BoardRef } from './types.js'

let http: FakeFetch, gw: FetchGateway
beforeEach(async () => {
  const prisma = createFakePrisma()
  await prisma.hostPolicy.create({ data: { host: '*', minIntervalMs: 10, burst: 5, maxConcurrency: 2, dailyBudget: 1000, probeBudgetPerDay: 10 } })
  http = new FakeFetch().install()
  gw = new FetchGateway(prisma, new FakeRedis() as any)
})
const ref = (atsType: string, slug: string, apiUrl: string, extra: Partial<BoardRef> = {}): BoardRef => ({ id: 'b', atsType, slug, apiUrl, companyName: 'Acme', ...extra })

describe('board engines — list parsing and external-id stability', () => {
  it('registry exposes all supported engines', () => {
    expect(supportedAts().sort()).toEqual(['ashby', 'greenhouse', 'lever', 'recruitee', 'smartrecruiters', 'teamtailor', 'workable', 'workday'])
    expect(engineFor('custom_json')).toBeNull()
  })

  it('greenhouse: list without content; detail fetches content + salary metadata', async () => {
    http.route(/\/jobs\/7(\?|$)/, { status: 200, body: { id: 7, content: '<p>Hello <b>world</b></p>', metadata: [{ name: 'Pay Range', value: '$100k-$120k' }] } })
    http.route(/\/jobs$/, { status: 200, body: { jobs: [{ id: 7, title: 'Eng', absolute_url: 'https://boards.greenhouse.io/acme/jobs/7', location: { name: 'Remote' }, updated_at: 'u', first_published: 'p', departments: [{ name: 'Eng' }] }] } })
    const e = engineFor('greenhouse')!
    const b = ref('greenhouse', 'acme', 'https://boards-api.greenhouse.io/v1/boards/acme/jobs')
    const { items } = await e.list(b, gw)
    expect(items![0]).toMatchObject({ externalId: '7', title: 'Eng', location: 'Remote', postedAt: 'p', department: 'Eng' })
    expect(items![0].description).toBeUndefined()
    const d = await e.detail!(b, items![0], gw)
    expect(d).toEqual({ description: 'Hello world', salaryHint: '$100k-$120k' })
    expect(http.requests.at(-1)!.url).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs/7?questions=false')
  })

  it('lever: list includes description + salaryRange + workplaceType', async () => {
    http.route(/api\.lever\.co/, { status: 200, body: [{ id: 'L1', text: 'Eng', hostedUrl: 'h', applyUrl: 'a', createdAt: 1700000000000, categories: { location: 'Remote - India', commitment: 'Full-time', team: 'Core' }, workplaceType: 'remote', descriptionPlain: 'desc', salaryRange: { min: 1, max: 2, currency: 'USD', interval: 'per-year-salary' } }] })
    const { items } = await engineFor('lever')!.list(ref('lever', 'acme', 'https://api.lever.co/v0/postings/acme?mode=json'), gw)
    expect(items![0]).toMatchObject({ externalId: 'L1', isRemoteFlag: true, employmentTypeHint: 'Full-time', description: 'desc', location: 'Remote - India' })
    expect(items![0].salaryHint).toMatch(/USD 1-2/)
  })

  it('ashby: posting API with compensation summary', async () => {
    http.route(/api\.ashbyhq\.com/, { status: 200, body: { jobs: [{ id: 'A1', title: 'Eng', jobUrl: 'j', location: 'Remote', isRemote: true, employmentType: 'FullTime', publishedAt: 'p', descriptionPlain: 'd', compensation: { scrapeableCompensationSalarySummary: '$150K – $200K' } }] } })
    const { items } = await engineFor('ashby')!.list(ref('ashby', 'acme', 'https://api.ashbyhq.com/posting-api/job-board/acme'), gw)
    expect(items![0]).toMatchObject({ externalId: 'A1', isRemoteFlag: true, salaryHint: '$150K – $200K', employmentTypeHint: 'FullTime' })
  })

  it('workable: POST with paging token', async () => {
    let calls = 0
    http.route(/apply\.workable\.com\/api\/v3/, (req) => { calls++; const b = JSON.parse(req.body!); return b.token ? { status: 200, body: { results: [{ shortcode: 'W2', title: 'B', remote: true }] } } : { status: 200, body: { results: [{ shortcode: 'W1', title: 'A', remote: false, location: { city: 'Berlin', country: 'Germany' } }], nextPage: 'tok' } } })
    const { items } = await engineFor('workable')!.list(ref('workable', 'acme', 'https://apply.workable.com/api/v3/accounts/acme/jobs'), gw)
    expect(calls).toBe(2)
    expect(items!.map((i) => i.externalId)).toEqual(['W1', 'W2'])
    expect(items![0].location).toBe('Berlin, Germany')
  })

  it('workday: refuses unscoped boards; scoped POST carries searchText', async () => {
    const e = engineFor('workday')!
    const unscoped = await e.list(ref('workday', 'x.wd5.myworkdayjobs.com/ext', 'https://x.wd5.myworkdayjobs.com/wday/cxs/x/ext/jobs'), gw)
    expect(unscoped.res.outcome).toBe('skipped')
    expect(http.requests.length).toBe(0)
    http.route(/myworkdayjobs\.com/, (req) => ({ status: 200, body: { total: 1, jobPostings: [{ title: 'SE', externalPath: '/job/Noida/SE_R1', locationsText: 'Noida, India' }] } }))
    const scoped = await e.list(ref('workday', 'x.wd5.myworkdayjobs.com/ext', 'https://x.wd5.myworkdayjobs.com/wday/cxs/x/ext/jobs', { queryScope: { searchText: 'Noida' } }), gw)
    expect(JSON.parse(http.requests.at(-1)!.body!).searchText).toBe('Noida')
    expect(scoped.items![0].externalId).toBe('/job/Noida/SE_R1')
  })

  it('external ids are stable across two fetches (no positional ids)', async () => {
    http.route(/api\.lever\.co/, { status: 200, body: [{ id: 'L2', text: 'B', hostedUrl: 'h' }, { id: 'L1', text: 'A', hostedUrl: 'h' }] })
    const b = ref('lever', 'acme', 'https://api.lever.co/v0/postings/acme?mode=json')
    const a = (await engineFor('lever')!.list(b, gw)).items!.map((i) => i.externalId).sort()
    http.route(/api\.lever\.co/, { status: 200, body: [{ id: 'L1', text: 'A', hostedUrl: 'h' }, { id: 'L3', text: 'C', hostedUrl: 'h' }, { id: 'L2', text: 'B', hostedUrl: 'h' }] })
    const c = (await engineFor('lever')!.list(b, gw)).items!.map((i) => i.externalId).sort()
    expect(a).toEqual(['L1', 'L2'])
    expect(c).toEqual(['L1', 'L2', 'L3'])
  })
})
