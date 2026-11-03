/**
 * E2E (simulated infra): dynamic preferences. Two users with different documents see the same corpus through
 * their own tiers, get their own alerts, and a preference change re-evaluates only that user.
 *   tsx tools/testkit/run-tests.ts e2e-prefs tools/sandbox-e2e/prefs.test.ts
 */
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'
process.env.TELEGRAM_BOT_TOKEN = 'sandbox-token'
process.env.TELEGRAM_CHAT_ID = '42'
process.env.NOTIFICATION_CHANNELS = 'telegram'
process.env.PAY_FLOOR_INR = '3000000'

import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@jobradar/db'
import { FakeRedis } from '../testkit/fake-redis.js'
import { FakeFetch } from '../testkit/fake-fetch.js'
import { FetchGateway, type RawJob } from '@jobradar/crawler'
import { EnrichService, SightingService, TieringService, type JobEvaluator } from '@jobradar/watchlist'
import { CrawlScopeService, EvalService, PreferencesService, SYSTEM_PRESETS, instantTierIds } from '@jobradar/prefs'
import { NextRequest } from 'next/server'
import { GET as jobsGET } from '../../apps/web/app/api/jobs/route.js'
import { GET as prefsGET, PUT as prefsPUT } from '../../apps/web/app/api/preferences/route.js'
import { POST as previewPOST } from '../../apps/web/app/api/preferences/preview/route.js'

const redis = new FakeRedis()
const http = new FakeFetch().install()
const gateway = new FetchGateway(prisma, redis as any)
const preferences = new PreferencesService(prisma)
const evals = new EvalService(prisma, { userCacheMs: 0 })
const crawlScope = new CrawlScopeService(prisma, evals)
const evaluator: JobEvaluator = {
  evaluateJob: (job) => evals.evaluateJob(job),
  instantTiers: async (userId) => { const u = (await evals.activeUsers(true)).find((x) => x.userId === userId); return u ? instantTierIds(u.prefs) : new Set() },
  ownerUserId: async () => (await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } }))?.id ?? null,
}
const enricher = new EnrichService(prisma, redis as any, gateway, evaluator)
const sightings = new SightingService(prisma)
const tiering = new TieringService(prisma, crawlScope)
const telegram: Array<{ chat_id: string; text: string }> = []
let owner: { id: string }, dev: { id: string }, source: { id: string }

const raw = (title: string, location: string, description: string, fp: string): RawJob => ({ title, company: `${title} Co`, applyUrl: `https://x.example/${fp}`, sourceUrl: `https://x.example/${fp}`, description, location, tags: [], sourceFingerprint: fp, sourceName: 'Remotive' })
async function ingest(r: RawJob) {
  const feedKey = `source:${source.id}`
  await sightings.reconcile({ feedKey, sourceId: source.id, items: [{ externalId: r.sourceFingerprint! }], fullList: false })
  return enricher.enrich({ feedKey, sourceId: source.id, externalId: r.sourceFingerprint!, raw: r, event: 'new' })
}
const feed = async (qs = 'tab=browse') => (await jobsGET(new NextRequest(`http://local/api/jobs?${qs}`) as any)).json()

describe('E2E · dynamic preferences', () => {
  beforeAll(async () => {
    http.route(/api\.telegram\.org/, (req) => { telegram.push(JSON.parse(req.body ?? '{}')); return { status: 200, body: { ok: true } } })
    owner = await prisma.user.create({ data: { email: 'owner@sandbox.local', role: 'admin', lastLoginAt: new Date() } })
    dev = await prisma.user.create({ data: { email: 'dev@sandbox.local', lastLoginAt: new Date() } })
    source = await prisma.source.create({ data: { name: 'Remotive', domain: 'remotive.io', sourceType: 'job_board', ingestionMethod: 'api', qualityScore: 85 } })
    await prisma.hostPolicy.create({ data: { host: '*', enabled: true } })
    await preferences.ensureSystemPresets()
  })

  it('1. owner is seeded from the legacy env; a second user takes the US preset', async () => {
    const o = await (await prefsGET()).json()
    expect(o.doc.home.country).toBe('IN')
    expect(o.doc.pay.floor).toBe(3_000_000)
    expect(o.source).toBe('seed')
    const us = SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!
    await preferences.save(dev.id, us.doc)
    await prisma.alertChannel.create({ data: { userId: dev.id, kind: 'telegram', address: '777', classes: ['tier1', 'tier2'] } })
  })

  it('2. the same postings land in different tiers per user, and alerts fan out per user', async () => {
    const r1 = await ingest(raw('Senior Go Engineer', 'Remote, Worldwide', 'Work from anywhere. Go, Postgres, Kafka.', 'j1'))
    const r2 = await ingest(raw('Platform Engineer', 'Remote - US', 'US residents only.', 'j2'))
    const r3 = await ingest(raw('Backend Engineer', 'Gurugram, Haryana, India (Hybrid)', 'Hybrid, 3 days in office.', 'j3'))
    expect(r1.status).toBe('created')
    expect(r1.evals!.get(owner.id)!.tier).toBe('tier1')
    expect(r1.evals!.get(dev.id)!.tier).toBe('tier1')
    expect(r2.evals!.get(owner.id)!.tier).toBe('none')
    expect(r2.evals!.get(dev.id)!.tier).toBe('tier2')
    expect(r3.evals!.get(owner.id)!.tier).toBe('none') // NCR hybrid but company not tagged mnc
    expect(r3.evals!.get(dev.id)!.tier).toBe('none')
    // alerts: j1 → both chats; j2 → only the dev's chat (owner's eval is 'none')
    expect(telegram.filter((m) => m.chat_id === '42').length).toBe(1)
    expect(telegram.filter((m) => m.chat_id === '777').length).toBe(2)
    expect(telegram.find((m) => m.chat_id === "777" && /Platform Engineer/.test(m.text))!.text).toMatch(/\[TIER2\] Remote in the US/)
    expect(await prisma.jobUserEval.count()).toBe(6)
    expect(await prisma.jobFacts.count()).toBe(3)
  })

  it('3. the inbox is built from evaluations: owner sees j1 only, with the tier label and reasons', async () => {
    const f = await feed()
    expect(f.engine).toBe('evals')
    expect(f.data.map((j: any) => j.title)).toEqual(['Senior Go Engineer'])
    expect(f.data[0].eval.tierLabel).toBe('Global remote')
    expect(f.data[0].eval.reasons).toEqual(expect.arrayContaining(['remote', 'eligible from IN']))
    expect(f.tiers.map((t: any) => t.id)).toEqual(['tier2', 'tier1', 'tier3'])
    const other = await feed('tab=browse&class=none')
    expect(other.data.map((j: any) => j.title).sort()).toEqual(['Backend Engineer', 'Platform Engineer'])
  })

  it('4. preview shows the effect of a change without saving; saving re-evaluates only that user', async () => {
    const cur = await (await prefsGET()).json()
    const doc = structuredClone(cur.doc)
    doc.tiers.find((t: any) => t.id === 'tier3').when.companyTag = undefined // hybrid NCR at any company
    const pv = await (await previewPOST(new NextRequest('http://local/api/preferences/preview', { method: 'POST', body: { doc } }) as any)).json()
    expect(pv.counts).toEqual({ tier1: 1, tier3: 1, none: 1 })
    expect(await prisma.userPreferences.findUnique({ where: { userId: owner.id } }).then((r: any) => r.version)).toBe(1)
    const res = await prefsPUT(new NextRequest('http://local/api/preferences', { method: 'PUT', body: { doc, note: 'hybrid anywhere in NCR' } }) as any)
    expect(res.status).toBe(202)
    const saved = await res.json()
    expect(saved.version).toBe(2)
    await new Promise((r) => setTimeout(r, 300)) // inline runner
    const j3 = await prisma.job.findFirst({ where: { title: 'Backend Engineer' } })
    expect((await prisma.jobUserEval.findUnique({ where: { userId_jobId: { userId: owner.id, jobId: j3.id } } })).tier).toBe('tier3')
    expect((await prisma.jobUserEval.findUnique({ where: { userId_jobId: { userId: dev.id, jobId: j3.id } } })).tier).toBe('none')
    const f = await feed()
    expect(f.data.map((j: any) => j.title).sort()).toEqual(['Backend Engineer', 'Senior Go Engineer'])
    expect((await preferences.history(owner.id)).map((h) => h.version)).toEqual([2, 1])
  })

  it('5. company tiering follows the union of users: a US-HQ company is watched for both; no posting matched → dormant', async () => {
    const c = await prisma.company.create({ data: { name: 'Nowhere Inc', normalizedName: 'nowhere inc', hqCountry: 'IN', discoveredVia: 'manual', status: 'watched', lastProbedAt: new Date(Date.now() - 7200_000) } })
    await prisma.companyBoard.create({ data: { companyId: c.id, atsType: 'greenhouse', slug: 'nowhere', host: 'boards-api.greenhouse.io', apiUrl: 'https://boards-api.greenhouse.io/v1/boards/nowhere/jobs', costClass: 'cheap' } })
    await tiering.recompute(await prisma.company.findUnique({ where: { id: c.id } }))
    // owner excludes IN HQ, dev does not → intersection is empty → NOT dormant for HQ reasons
    const after = await prisma.company.findUnique({ where: { id: c.id } })
    expect(after.statusReason).not.toMatch(/hq_excluded|india_hq/)
    const scope = await crawlScope.scope(true)
    expect(scope.excludedHqCountries).toEqual([])
    expect(scope.countries.sort()).toEqual(['IN', 'US'])
    expect(scope.floorUsd).toBeNull() // the US preset has no floor → no demotion for anyone
  })
})
