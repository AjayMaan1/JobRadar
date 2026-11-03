/**
 * Simulated end-to-end run of the v2 pipeline:
 *   fixture ATS boards → Fetch Gateway → engines → sightings diff → enrich (classify/dedupe/score)
 *   → Telegram alert → dashboard API (/api/jobs, /api/health) → closure → rate-limit circuit
 *   → alert cap + digest → aggregator dedupe/discovery → liveness → tiering → resolver/prober → retention
 *
 * Real code under test; only Prisma, Redis and HTTP are in-memory doubles (tools/testkit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { prisma } from '@jobradar/db'
import { FakeRedis } from '../testkit/fake-redis.js'
import { FakeFetch, etagJson } from '../testkit/fake-fetch.js'
import { FetchGateway, candidateFromApplyUrl, type RawJob } from '@jobradar/crawler'
import {
  BoardPollService, EnrichService, SightingService, DispatcherService, TieringService, LivenessService,
  ResolverService, ProberService, RetentionService, DiscoveryService, HealthService, type EnrichPayload,
} from '@jobradar/watchlist'
import { NotificationService } from '@jobradar/notifications'
import { HOST_POLICIES } from '../../packages/db/prisma/seeds/host-policies.js'
import { NextRequest } from 'next/server'
import { GET as jobsGET } from '../../apps/web/app/api/jobs/route.js'
import { GET as healthGET } from '../../apps/web/app/api/health/route.js'
import { sent as emailsSent } from 'nodemailer'

// v3: routes require a session; the sandbox runs in single-user dev mode with inline queues and no AI.
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'
process.env.TELEGRAM_BOT_TOKEN = 'sandbox-token'
process.env.TELEGRAM_CHAT_ID = '42'
process.env.NOTIFICATION_CHANNELS = 'telegram,email'
process.env.SMTP_HOST = 'smtp.sandbox'
process.env.SMTP_USER = 'radar@sandbox'
process.env.EMAIL_TO = 'me@sandbox'

const redis = new FakeRedis()
const http = new FakeFetch().install()
const gateway = new FetchGateway(prisma, redis as any)
const boards = new BoardPollService(prisma, gateway)
const enricher = new EnrichService(prisma, redis as any, gateway)
const sightings = new SightingService(prisma)
const dispatcher = new DispatcherService(prisma)
const tiering = new TieringService(prisma)
const liveness = new LivenessService(prisma, gateway)
const resolver = new ResolverService(prisma, gateway)
const prober = new ProberService(prisma, gateway)
const retention = new RetentionService(prisma)
const notifications = new NotificationService(prisma, redis as any)
const discovery = new DiscoveryService(prisma)
const health = new HealthService(prisma)

const telegram: any[] = []
let ghJobs: any[] = []
let ghEtag = 'W/"gh-v1"'
let leverMode: 'ok' | '429' = 'ok'

const gh = (id: number, title: string, location: string) => ({ id, title, absolute_url: `https://boards.greenhouse.io/gitlab/jobs/${id}`, location: { name: location }, updated_at: '2026-06-01T09:00:00Z', first_published: '2026-06-01T09:00:00Z', departments: [{ name: 'Engineering' }] })

function fixtures() {
  // robots + telegram + misc
  http.route(/\/robots\.txt$/, { status: 200, body: 'User-agent: *\nDisallow: /private\n' })
  http.route(/api\.telegram\.org/, (req) => { telegram.push(JSON.parse(req.body ?? '{}')); return { status: 200, body: { ok: true } } })

  // Greenhouse — GitLab (ETag-aware list, detail per job)
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/gitlab\/jobs\/(\d+)/, (req) => {
    const id = Number(req.url.match(/jobs\/(\d+)/)![1])
    const details: Record<number, any> = {
      101: { content: '<p>We are a fully remote company and hire anywhere in the world. Ruby, Go, PostgreSQL.</p>', metadata: [{ name: 'Salary Range', value: '$150,000 - $190,000' }] },
      102: { content: '<p>Candidates must be based in the United States. React, TypeScript.</p>' },
      104: { content: '<p>Kubernetes, Terraform, AWS. Work from anywhere, async-first.</p>' },
    }
    return { status: 200, body: { id, ...(details[id] ?? { content: '<p>Engineering role. Python.</p>' }) } }
  })
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/gitlab\/jobs$/, (req) => etagJson({ jobs: ghJobs }, ghEtag)(req))

  // Greenhouse — Restricted Inc
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/restricted\/jobs\/\d+/, { status: 200, body: { id: 901, content: '<p>US only. Java, AWS.</p>' } })
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/restricted\/jobs$/, { status: 200, body: { jobs: [gh(901, 'Senior Software Engineer', 'Remote (US)')] } })

  // Greenhouse — BurstCo (12 P1 roles → alert cap)
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/burstco\/jobs\/\d+/, { status: 200, body: { id: 0, content: '<p>Worldwide remote. Node.js, TypeScript, AWS.</p>' } })
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/burstco\/jobs$/, { status: 200, body: { jobs: Array.from({ length: 12 }, (_, i) => ({ ...gh(500 + i, `Backend Engineer ${i + 1}`, 'Remote, Worldwide'), absolute_url: `https://boards.greenhouse.io/burstco/jobs/${500 + i}` })) } })

  // Greenhouse — TinyStartup (resolved later from an HN-style discovery)
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/tinystartup\/jobs\/\d+/, { status: 200, body: { id: 0, content: '<p>Remote anywhere, 4h overlap with CET. Go, Postgres.</p>' } })
  http.route(/boards-api\.greenhouse\.io\/v1\/boards\/tinystartup\/jobs$/, { status: 200, body: { jobs: [{ ...gh(700, 'Founding Engineer', 'Remote, Anywhere'), absolute_url: 'https://boards.greenhouse.io/tinystartup/jobs/700' }] } })
  http.route('https://tinystartup.com/careers', { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><h1>Join us</h1><script src="https://boards.greenhouse.io/embed/job_board/js?for=tinystartup"></script></body></html>' })

  // Lever — Atlassian (list includes descriptions); can be switched to 429
  http.route(/api\.lever\.co\/v0\/postings\/atlassian/, () => {
    if (leverMode === '429') return { status: 429, headers: { 'retry-after': '120' }, body: 'slow down' }
    return {
      status: 200,
      body: [
        { id: 'lv-1', text: 'Senior Software Engineer, Backend', hostedUrl: 'https://jobs.lever.co/atlassian/lv-1', applyUrl: 'https://jobs.lever.co/atlassian/lv-1/apply', createdAt: Date.now() - 3600_000, categories: { location: 'Remote - India', team: 'Engineering', commitment: 'Full-time' }, workplaceType: 'remote', descriptionPlain: 'TEAM Anywhere. Java, Kotlin, AWS. Work from India remotely.' },
        { id: 'lv-2', text: 'Software Engineering Intern', hostedUrl: 'https://jobs.lever.co/atlassian/lv-2', createdAt: Date.now() - 3600_000, categories: { location: 'Remote - India', team: 'Engineering', commitment: 'Intern' }, workplaceType: 'remote', descriptionPlain: 'Internship. Python.' },
      ],
    }
  })

  // Workday — Adobe, scoped to Noida
  http.route(/adobe\.wd5\.myworkdayjobs\.com\/wday\/cxs\/adobe\/external_experienced\/jobs$/, (req) => {
    const body = JSON.parse(req.body ?? '{}')
    expect(body.searchText).toBe('Noida')
    return { status: 200, body: { total: 1, jobPostings: [{ title: 'Senior Software Engineer', externalPath: '/job/Noida/Senior-Software-Engineer_R1', locationsText: 'Noida, Uttar Pradesh, India', bulletFields: ['Hybrid'] }] } }
  })
  http.route(/adobe\.wd5\.myworkdayjobs\.com\/wday\/cxs\/adobe\/external_experienced\/job\//, { status: 200, body: { jobPostingInfo: { jobDescription: '<p>Hybrid role at Adobe Noida. Java, microservices.</p>', timeType: 'Full time' } } })

  // Aggregator-only job liveness
  http.route('https://tinyshop.example/jobs/42', { status: 404, body: 'gone' })
}

async function seed() {
  for (const hp of HOST_POLICIES) await prisma.hostPolicy.create({ data: hp })
  const mk = async (name: string, domain: string, hq: string, tags: string[], tier: string, anchor = true) =>
    prisma.company.create({ data: { name, normalizedName: name.toLowerCase(), domain, hqCountry: hq, tags, anchor, status: 'watched', tier, manualTier: anchor ? 'hot' : null, discoveredVia: 'manual', lastProbedAt: new Date(Date.now() - 2 * 3600_000), qualityScore: 80 } })
  const gitlab = await mk('GitLab', 'gitlab.com', 'US', ['anchor', 'remote_first'], 'hot')
  const atlassian = await mk('Atlassian', 'atlassian.com', 'AU', ['anchor', 'big_tech'], 'hot')
  const adobe = await mk('Adobe', 'adobe.com', 'US', ['anchor', 'mnc', 'big_tech'], 'warm')
  const restricted = await mk('Restricted Inc', 'restricted.example', 'US', [], 'warm', false)
  const burst = await mk('BurstCo', 'burstco.example', 'US', [], 'hot', false)
  const board = (companyId: string, atsType: string, slug: string, host: string, apiUrl: string, costClass: string, queryScope?: any) =>
    prisma.companyBoard.create({ data: { companyId, atsType, slug, host, apiUrl, costClass, queryScope: queryScope ?? null, nextPollAt: new Date(Date.now() - 1000) } })
  await board(gitlab.id, 'greenhouse', 'gitlab', 'boards-api.greenhouse.io', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs', 'cheap')
  await board(atlassian.id, 'lever', 'atlassian', 'api.lever.co', 'https://api.lever.co/v0/postings/atlassian?mode=json', 'cheap')
  await board(adobe.id, 'workday', 'adobe.wd5.myworkdayjobs.com/external_experienced', 'adobe.wd5.myworkdayjobs.com', 'https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs', 'expensive', { searchText: 'Noida' })
  await board(restricted.id, 'greenhouse', 'restricted', 'boards-api.greenhouse.io', 'https://boards-api.greenhouse.io/v1/boards/restricted/jobs', 'cheap')
  await board(burst.id, 'greenhouse', 'burstco', 'boards-api.greenhouse.io', 'https://boards-api.greenhouse.io/v1/boards/burstco/jobs', 'cheap')
  await prisma.source.create({ data: { name: 'Remotive', domain: 'remotive.io', sourceType: 'job_board', ingestionMethod: 'api', qualityScore: 85 } })
}

async function pollAll(filter?: (id: string) => boolean) {
  const due = await dispatcher.claimDue()
  const outcomes: Record<string, any> = {}
  const payloads: EnrichPayload[] = []
  for (const id of due) {
    if (filter && !filter(id)) continue
    const r = await boards.poll(id, 'list')
    const b = await prisma.companyBoard.findUnique({ where: { id } })
    outcomes[b.slug] = r
    payloads.push(...r.enrich)
  }
  const enriched = []
  for (const p of payloads) enriched.push({ p, r: await enricher.enrich(p) })
  return { due, outcomes, enriched }
}

async function makeDue() {
  await prisma.companyBoard.updateMany({ where: {}, data: { nextPollAt: new Date(Date.now() - 1000), backoffUntil: null } })
}

const jobBy = (title: string) => prisma.job.findFirst({ where: { title } })
const dashboard = async (qs: string) => (await jobsGET(new NextRequest(`http://local/api/jobs?${qs}`) as any)).json()

describe('E2E · v2 pipeline (simulated infra)', () => {
  afterAll(async () => {
    // Human-readable artifacts: what the dashboard returns, what the user received on Telegram, health.
    const browse = await dashboard('tab=browse&limit=50')
    const closed = await dashboard('tab=closed&limit=50')
    const h = await (await healthGET(new NextRequest('http://local/api/health') as any)).json()
    const row = (j: any) => `| ${j.opportunityClass} | ${j.title} | ${j.company} | ${j.employmentType} | ${j.rankingScore} | ${j.classReason ?? ''} | ${j.status}${j.closedAt ? ' (closed)' : ''} |`
    const md = [
      '# e2e-artifacts', '', `Generated ${new Date().toISOString()} — produced by tools/sandbox-e2e/e2e.test.ts`, '',
      '## Dashboard · GET /api/jobs?tab=browse (what the user sees)', '', `Total: ${browse.total}`, '',
      '| class | title | company | type | score | reason | status |', '|---|---|---|---|---|---|---|', ...browse.data.map(row), '',
      '## Dashboard · GET /api/jobs?tab=closed', '', `Total: ${closed.total}`, '', '| class | title | company | type | score | reason | status |', '|---|---|---|---|---|---|---|', ...closed.data.map(row), '',
      `## Telegram alerts received (${telegram.length})`, '', ...telegram.map((m, i) => `### ${i + 1}\n\n\`\`\`\n${m.text}\n\`\`\``), '',
      `## Email digest`, '', emailsSent.length ? '```\n' + emailsSent.at(-1).subject + '\n\n' + emailsSent.at(-1).text + '\n```' : '(none)', '',
      '## GET /api/health', '', '```json', JSON.stringify({ counts: h.counts, timeToDetect: h.timeToDetect, alerts: h.alerts, hosts: h.hosts.map((x: any) => ({ host: x.host, total: x.total, unchanged: x.unchanged, changed: x.changed, rateLimited: x.rateLimited, blocked: x.blocked })) }, null, 2), '```', '',
      `## Outbound HTTP (${http.requests.length} requests through the gateway)`, '',
      ...Object.entries(http.requests.reduce<Record<string, number>>((a, r) => { const host = new URL(r.url).host; a[host] = (a[host] ?? 0) + 1; return a }, {})).map(([host, n]) => `- ${host}: ${n}`), '',
    ].join('\n')
    mkdirSync('reports', { recursive: true })
    writeFileSync('reports/e2e-artifacts.md', md)
    writeFileSync('reports/dashboard-sample.json', JSON.stringify(browse, null, 2))
  })

  beforeAll(async () => {
    fixtures()
    ghJobs = [gh(101, 'Senior Backend Engineer, Ruby', 'Remote, Worldwide'), gh(102, 'Staff Frontend Engineer', 'Remote - US'), gh(103, 'Marketing Manager', 'Remote')]
    await seed()
  })

  it('1. dispatcher claims due boards by tier priority and leases them', async () => {
    const due = await dispatcher.claimDue()
    expect(due.length).toBe(5)
    const again = await dispatcher.claimDue()
    expect(again.length).toBe(0)
    await makeDue()
  })

  it('2. first poll: engines fetch via gateway, sightings created, jobs enriched + classified', async () => {
    const { outcomes, enriched } = await pollAll((id) => true)
    expect(outcomes.gitlab.outcome).toBe('changed')
    expect(outcomes.gitlab.newCount).toBe(3)
    expect(outcomes.atlassian.newCount).toBe(2)
    expect(outcomes['adobe.wd5.myworkdayjobs.com/external_experienced'].newCount).toBe(1)
    expect(outcomes.burstco.newCount).toBe(12)

    const p1 = await jobBy('Senior Backend Engineer, Ruby')
    expect(p1).toBeTruthy()
    expect(p1.opportunityClass).toBe('p1_global_remote')
    expect(p1.employmentType).toBe('unknown') // no signal in posting → unknown (still alertable)
    expect(p1.salaryMin).toBe(150000)
    expect(p1.salaryInrMin).toBeGreaterThan(10_000_000)
    expect(p1.companyId).toBeTruthy()
    expect(p1.baseScore).toBeGreaterThanOrEqual(40 + 30) // class band + top compensation band

    const restricted = await jobBy('Staff Frontend Engineer')
    expect(restricted.opportunityClass).toBe('none')
    expect(restricted.classReason).toMatch(/restricted/)

    expect(await jobBy('Marketing Manager')).toBeNull() // filtered before extraction
    const irrelevant = enriched.find((e) => e.p.raw.title === 'Marketing Manager')
    expect(irrelevant?.r.status).toBe('irrelevant')

    const p2 = await jobBy('Senior Software Engineer, Backend')
    expect(p2.opportunityClass).toBe('p2_india_remote')
    const intern = await jobBy('Software Engineering Intern')
    expect(intern.employmentType).toBe('internship')

    const p3 = await jobBy('Senior Software Engineer')
    expect(p3.opportunityClass).toBe('p3_ncr_hybrid')
    expect(p3.remoteType).toBe('hybrid')

    const usOnly = await prisma.job.findFirst({ where: { company: 'Restricted Inc' } })
    expect(usOnly.opportunityClass).toBe('none')
  })

  it('3. alerts: P1 + P2 instant, P3/none/internship not; cap of 10 per feed per hour; detail fetched once', async () => {
    const titles = telegram.map((m) => m.text)
    expect(titles.some((t) => t.includes('[P1] Global remote') && t.includes('Senior Backend Engineer, Ruby'))).toBe(true)
    expect(titles.some((t) => t.includes('[P2] India remote') && t.includes('Senior Software Engineer, Backend'))).toBe(true)
    expect(titles.some((t) => t.includes('Intern'))).toBe(false)
    expect(titles.some((t) => t.includes('[P3]'))).toBe(false)
    expect(titles.some((t) => t.includes('Staff Frontend'))).toBe(false)
    // BurstCo: 12 P1 roles → 10 sent + 2 deferred
    expect(titles.filter((t) => t.includes('BurstCo')).length).toBe(10)
    expect(await prisma.notification.count({ where: { notificationType: 'deferred' } })).toBe(2)
    expect(telegram.length).toBe(12)
    // GitLab detail endpoints hit exactly once per relevant job (101, 102), never for the irrelevant one
    expect(http.count((r) => /gitlab\/jobs\/101/.test(r.url))).toBe(1)
    expect(http.count((r) => /gitlab\/jobs\/103/.test(r.url))).toBe(0)
    // pay evidence recorded from own posting
    expect(await prisma.payEvidence.count({ where: { source: 'own_posting' } })).toBe(1)
    const gitlab = await prisma.company.findUnique({ where: { domain: 'gitlab.com' } })
    expect(gitlab.payBandStatus).toBe('unknown') // single data point → confidence < 0.6, no demotion
  })

  it('4. dashboard /api/jobs shows eligible classes newest-first, hides none/internships; class filter works', async () => {
    const res = await dashboard('tab=browse')
    expect(res.total).toBe(3 + 12) // P1 gitlab + P2 atlassian + P3 adobe + 12 burst
    expect(res.data.every((j: any) => j.opportunityClass !== 'none' && j.employmentType !== 'internship')).toBe(true)
    expect(res.data[0].opportunityClass).toBe('p1_global_remote')
    expect(res.data.find((j: any) => j.title === 'Senior Software Engineer').opportunityClass).toBe('p3_ncr_hybrid')
    expect(res.data[0].rankingScore).toBeGreaterThan(res.data[0].baseScore) // freshness applied at read time
    const only1 = await dashboard('class=p1_global_remote&company=GitLab')
    expect(only1.total).toBe(1)
    const p2 = await dashboard('class=p2_india_remote')
    expect(p2.data.map((j: any) => j.company)).toEqual(['Atlassian'])
    const other = await dashboard('class=none')
    expect(other.total).toBe(2) // restricted gitlab + restricted inc
    const health = await (await healthGET(new NextRequest('http://local/api/health') as any)).json()
    expect(health.counts.p1_24h).toBe(13)
    expect(health.counts.p2_24h).toBe(1)
    expect(health.counts.p3_24h).toBe(1)
  })

  it('5. unchanged poll: conditional GET → 304, no enrich, no alerts', async () => {
    await makeDue()
    const before = telegram.length
    const { outcomes } = await pollAll((id) => true)
    expect(outcomes.gitlab.outcome).toBe('unchanged')
    const last = http.requests.filter((r) => /boards\/gitlab\/jobs$/.test(r.url)).pop()!
    expect(last.headers['if-none-match']).toBe(ghEtag)
    expect(telegram.length).toBe(before)
    const b = await prisma.companyBoard.findFirst({ where: { slug: 'gitlab' } })
    expect(b.consecutiveUnchanged).toBe(1)
  })

  it('6. new posting appears → exactly one new alert, time-to-detect recorded', async () => {
    ghJobs = [...ghJobs, gh(104, 'Platform Engineer', 'Remote, Worldwide')]
    ghEtag = 'W/"gh-v2"'
    await makeDue()
    const before = telegram.length
    const { outcomes } = await pollAll((id) => true)
    expect(outcomes.gitlab.newCount).toBe(1)
    expect(telegram.length).toBe(before + 1)
    expect(telegram.at(-1).text).toContain('Platform Engineer')
    const ttd = await health.timeToDetect(7)
    expect(ttd.samples).toBeGreaterThan(0)
  })

  it('7. closure: posting disappears for 2 polls → job closed → hidden from browse, visible in Closed; reappearance reopens without re-alert', async () => {
    ghJobs = ghJobs.filter((j) => j.id !== 101)
    ghEtag = 'W/"gh-v3"'
    await makeDue(); await pollAll()
    let j = await jobBy('Senior Backend Engineer, Ruby')
    expect(j.closedAt).toBeNull() // missing_count = 1
    ghEtag = 'W/"gh-v4"'
    await makeDue(); await pollAll()
    j = await jobBy('Senior Backend Engineer, Ruby')
    expect(j.closedAt).toBeTruthy()
    expect(j.status).toBe('closed')
    expect((await dashboard('tab=browse')).data.some((x: any) => x.id === j.id)).toBe(false)
    expect((await dashboard('tab=closed')).data.some((x: any) => x.id === j.id)).toBe(true)
    expect((await dashboard('tab=browse&includeClosed=true')).data.some((x: any) => x.id === j.id)).toBe(false) // status closed, not new

    const before = telegram.length
    ghJobs = [gh(101, 'Senior Backend Engineer, Ruby', 'Remote, Worldwide'), ...ghJobs]
    ghEtag = 'W/"gh-v5"'
    await makeDue(); await pollAll()
    j = await jobBy('Senior Backend Engineer, Ruby')
    expect(j.closedAt).toBeNull()
    expect(j.status).toBe('new')
    expect(telegram.length).toBe(before) // notification dedupe on canonical hash
  })

  it('8. suspect-drop guard: a >50% shrink does not close anything', async () => {
    const burst = await prisma.companyBoard.findFirst({ where: { slug: 'burstco' } })
    const r = await sightings.reconcile({ feedKey: `board:${burst.id}`, boardId: burst.id, items: [{ externalId: '500' }], fullList: true, previousCount: 12 })
    expect(r.suspectDrop).toBe(true)
    expect(r.goneIds.length).toBe(0)
    expect(await prisma.job.count({ where: { company: 'BurstCo', closedAt: { not: null } } })).toBe(0)
  })

  it('9. rate limit: 429 opens the host circuit; next poll is skipped without an HTTP request', async () => {
    leverMode = '429'
    await makeDue()
    const { outcomes } = await pollAll((id) => true)
    expect(outcomes.atlassian.outcome).toBe('rate_limited')
    const hp = await prisma.hostPolicy.findUnique({ where: { host: 'api.lever.co' } })
    expect(hp.circuitState).toBe('open')
    expect(hp.circuitOpenUntil.getTime()).toBeGreaterThan(Date.now() + 100_000)
    const reqs = http.count((r) => /api\.lever\.co/.test(r.url))
    await makeDue()
    const second = await pollAll((id) => true)
    expect(second.outcomes.atlassian.outcome).toBe('skipped')
    expect(http.count((r) => /api\.lever\.co/.test(r.url))).toBe(reqs)
    leverMode = 'ok'
    await prisma.hostPolicy.update({ where: { host: 'api.lever.co' }, data: { circuitState: 'closed', circuitOpenUntil: null } })
  })

  it('10. daily digest: P3 + deferred (capped) jobs, excluding instant-alerted ones', async () => {
    const n = await notifications.sendDailyDigest()
    expect(n).toBe(3) // 1 P3 (Adobe) + 2 deferred BurstCo
    const mail = emailsSent.at(-1)
    expect(mail.subject).toMatch(/JobRadar Digest/)
    expect(mail.text).toContain('NCR hybrid')
    expect(mail.text).not.toContain('Senior Backend Engineer, Ruby')
  })

  it('11. aggregator path: apply URL matching a board job dedupes by URL (no new job, no alert) and seeds a discovery', async () => {
    const source = await prisma.source.findFirst({ where: { domain: 'remotive.io' } })
    const raw: RawJob = { title: 'Platform Engineer', company: 'GitLab', applyUrl: 'https://boards.greenhouse.io/gitlab/jobs/104?gh_src=remotive', sourceUrl: 'https://remotive.com/remote-jobs/1', description: 'Kubernetes, AWS. Worldwide.', location: 'Worldwide', tags: [], sourceFingerprint: 'remotive-1', sourceName: 'Remotive' }
    const feedKey = `source:${source.id}`
    const rec = await sightings.reconcile({ feedKey, sourceId: source.id, items: [{ externalId: raw.sourceFingerprint }], fullList: false })
    expect(rec.newIds).toEqual(['remotive-1'])
    const before = { jobs: await prisma.job.count(), tg: telegram.length }
    const r = await enricher.enrich({ feedKey, sourceId: source.id, externalId: 'remotive-1', raw, event: 'new' })
    expect(r.status).toBe('updated')
    expect(await prisma.job.count()).toBe(before.jobs)
    expect(telegram.length).toBe(before.tg)
    expect(candidateFromApplyUrl('GitLab', raw.applyUrl)?.externalRef).toBe('greenhouse:gitlab')
    expect(await prisma.companyDiscovery.count({ where: { source: 'aggregator_apply_url', externalRef: 'greenhouse:gitlab' } })).toBe(1)
  })

  it('12. aggregator-only job: created + alerted; liveness closes it on 404 after 14d', async () => {
    const source = await prisma.source.findFirst({ where: { domain: 'remotive.io' } })
    const raw: RawJob = { title: 'Senior Go Engineer', company: 'Tiny Shop', applyUrl: 'https://tinyshop.example/jobs/42', sourceUrl: 'https://tinyshop.example/jobs/42', description: 'Fully remote, work from anywhere. Go, Postgres.', location: 'Worldwide', tags: [], sourceFingerprint: 'remotive-2', sourceName: 'Remotive' }
    const feedKey = `source:${source.id}`
    await sightings.reconcile({ feedKey, sourceId: source.id, items: [{ externalId: 'remotive-2' }], fullList: false })
    const before = telegram.length
    const r = await enricher.enrich({ feedKey, sourceId: source.id, externalId: 'remotive-2', raw, event: 'new' })
    expect(r.status).toBe('created')
    expect(r.opportunityClass).toBe('p1_global_remote')
    expect(telegram.length).toBe(before + 1)
    const job = await jobBy('Senior Go Engineer')
    await prisma.job.update({ where: { id: job.id }, data: { firstSeenAt: new Date(Date.now() - 20 * 86400_000) } })
    const lr = await liveness.run()
    expect(lr.checked).toBe(1)
    expect(lr.closed).toBe(1)
    expect((await jobBy('Senior Go Engineer')).status).toBe('closed')
  })

  it('13. tiering derives status/tier from evidence; anchors exempt from dormancy', async () => {
    const r = await tiering.run()
    expect(r.companies).toBeGreaterThanOrEqual(5)
    const gitlab = await prisma.company.findUnique({ where: { domain: 'gitlab.com' } })
    expect(gitlab.bestClass).toBe('p1_global_remote')
    expect(gitlab.tier).toBe('hot')
    expect(gitlab.status).toBe('watched')
    const adobe = await prisma.company.findUnique({ where: { domain: 'adobe.com' } })
    expect(adobe.bestClass).toBe('p3_ncr_hybrid')
    expect(adobe.tier).toBe('warm')
    expect(adobe.offices).toContain('Delhi NCR')
    const restricted = await prisma.company.findUnique({ where: { domain: 'restricted.example' } })
    expect(restricted.status).toBe('dormant')
    expect(restricted.tier).toBe('dormant')
    expect(restricted.statusReason).toMatch(/no P1\/P2\/P3/)
  })

  it('14. discovery → resolver (detects embedded Greenhouse board from careers HTML) → probe (no alerts) → watched', async () => {
    await discovery.record({ source: 'hn_who_is_hiring', externalRef: 'thread:1', nameAsSeen: 'TinyStartup', domainAsSeen: 'tinystartup.com', careersUrlAsSeen: 'https://tinystartup.com/careers', hqCountryHint: 'DE', remoteHint: true })
    const rr = await resolver.resolvePending()
    expect(rr.resolved).toBe(2) // TinyStartup + the greenhouse:gitlab discovery from step 11 (maps onto the existing board)
    expect(await prisma.companyBoard.count({ where: { slug: 'gitlab' } })).toBe(1)
    const company = await prisma.company.findUnique({ where: { domain: 'tinystartup.com' } })
    expect(company.status).toBe('probing')
    const board = await prisma.companyBoard.findFirst({ where: { companyId: company.id } })
    expect(board.atsType).toBe('greenhouse')
    expect(board.slug).toBe('tinystartup')
    const pending = await prober.pendingBoards()
    expect(pending).toContain(board.id)
    const before = telegram.length
    const pr = await prober.probeBoard(board.id)
    expect(pr.outcome).toBe('changed')
    for (const e of pr.enrich) await enricher.enrich(e)
    expect(telegram.length).toBe(before) // probes never alert
    expect((await jobBy('Founding Engineer')).opportunityClass).toBe('p1_global_remote')
    expect((await prisma.company.findUnique({ where: { id: company.id } })).status).toBe('watched')
    await tiering.recompute(await prisma.company.findUnique({ where: { id: company.id } }))
    const after = await prisma.company.findUnique({ where: { id: company.id } })
    expect(after.status).toBe('watched')
    expect(after.bestClass).toBe('p1_global_remote')
    // an agency-looking discovery is rejected
    await discovery.record({ source: 'github_list', externalRef: 'x:agency', nameAsSeen: 'Acme Staffing Solutions', careersUrlAsSeen: 'https://acme-staffing.example/jobs' })
    expect((await resolver.resolvePending()).rejected).toBe(1)
  })

  it('15. retention prunes old fetch_runs and long-gone sightings but never live ones', async () => {
    await prisma.fetchRun.create({ data: { host: 'x', outcome: 'changed', startedAt: new Date(Date.now() - 40 * 86400_000) } })
    await prisma.jobSighting.create({ data: { feedKey: 'board:old', externalId: 'old-1', payloadHash: 'h', goneAt: new Date(Date.now() - 400 * 86400_000) } })
    const live = await prisma.jobSighting.count({ where: { goneAt: null } })
    const r = await retention.run()
    expect(r.fetchRuns).toBeGreaterThanOrEqual(1)
    expect(r.sightings).toBe(1)
    expect(await prisma.jobSighting.count({ where: { goneAt: null } })).toBe(live)
  })

  it('16. gateway politeness: honest UA on every request, robots honoured for HTML, budgets tracked', async () => {
    expect(http.requests.filter((r) => !/api\.telegram\.org|127\.0\.0\.1:11434/.test(r.url)).every((r) => r.headers['user-agent']?.startsWith('JobRadar/2.0'))).toBe(true) // ops egress (Telegram, local Ollama) is not crawl traffic
    const res = await gateway.fetch({ url: 'https://tinystartup.com/private/secret', purpose: 'discovery', kind: 'html' })
    expect(res.outcome).toBe('skipped')
    expect(res.error).toMatch(/robots/)
    expect(await gateway.hostThrottle.budgetUsed('boards-api.greenhouse.io')).toBeGreaterThan(10)
  })
})
