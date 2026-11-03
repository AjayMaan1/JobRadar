/**
 * UI smoke server (docs/IMPLEMENTATION-v8.md §verification).
 *
 *  - seeds the in-memory Prisma double through the REAL services (ingest → evals, resume → report → suggestions)
 *  - bridges `/api/*` to the REAL Next.js route handlers under apps/web/app/api (file-system routing, [id] params,
 *    JSON / multipart bodies, NextResponse + Response results)
 *  - serves the esbuild bundle of the real page components (tools/ui-smoke/harness.tsx) for every other path
 *
 *    tsx tools/ui-smoke/server.ts [port]        → prints "ready" when listening; SIGTERM to stop
 */
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'gemini,fake' // exercises the provider-chain card on Admin → Overview; no real calls are made
process.env.GEMINI_API_KEY = 'smoke-key'
process.env.LLM_GEMINI_BASE_URL = `http://127.0.0.1:${process.argv[2] ?? process.env.UI_SMOKE_PORT ?? '18100'}/v1`
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'
process.env.PDF_RENDERER = 'simple'
process.env.PAY_FLOOR_INR = '3000000'
process.env.TELEGRAM_BOT_TOKEN = 'sandbox-token'
process.env.TELEGRAM_CHAT_ID = '42'
process.env.NOTIFICATION_CHANNELS = 'telegram'
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn'

import http from 'node:http'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prisma } from '@jobradar/db'
import { NextRequest } from 'next/server'
import { setRequestContext } from 'next/headers'
import { FakeRedis } from '../testkit/fake-redis.js'
import { FakeFetch } from '../testkit/fake-fetch.js'
import { FetchGateway, type RawJob } from '@jobradar/crawler'
import { EnrichService, SightingService, type JobEvaluator } from '@jobradar/watchlist'
import { EvalService, PreferencesService, instantTierIds } from '@jobradar/prefs'
import { ResumeContentSchema, analyzeJdDeterministic, scoreResume } from '@jobradar/resume'
import { SAMPLE_RESUME, SAMPLE_JD, SAMPLE_JD_TITLE } from '../../packages/resume/src/__fixtures__/sample.js'
import { HOST_POLICIES } from '../../packages/db/prisma/seeds/host-policies.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const API_ROOT = resolve(ROOT, 'apps/web/app/api')
const PORT = parseInt(process.argv[2] ?? process.env.UI_SMOKE_PORT ?? '18100', 10)
const BUNDLE = process.env.UI_SMOKE_BUNDLE ?? '/tmp/ui-smoke/bundle.js'

// ── seed ─────────────────────────────────────────────────────────────────────────────────────────────────
const redis = new FakeRedis()
const fake = new FakeFetch().install()
fake.route(/api\.telegram\.org/, { status: 200, body: { ok: true } })
const gateway = new FetchGateway(prisma, redis as any)
const preferences = new PreferencesService(prisma)
const evals = new EvalService(prisma, { userCacheMs: 0 })
const evaluator: JobEvaluator = {
  evaluateJob: (job) => evals.evaluateJob(job),
  instantTiers: async (userId) => { const u = (await evals.activeUsers(true)).find((x) => x.userId === userId); return u ? instantTierIds(u.prefs) : new Set() },
  ownerUserId: async () => (await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } }))?.id ?? null,
}
const enricher = new EnrichService(prisma, redis as any, gateway, evaluator)
const sightings = new SightingService(prisma)

export const seeded: { owner?: { id: string }; resumeId?: string; masterVersionId?: string; jobs: Record<string, string> } = { jobs: {} }

async function seed() {
  const owner = await prisma.user.create({ data: { email: 'owner@sandbox.local', role: 'admin', name: 'Asha Verma', lastLoginAt: new Date() } })
  seeded.owner = owner
  for (const hp of HOST_POLICIES) await prisma.hostPolicy.create({ data: hp })
  await preferences.ensureSystemPresets()
  await prisma.candidateProfile.create({ data: { userId: owner.id, headline: 'Senior Backend Engineer · Go, Kubernetes', about: 'I build payment systems that stay up.', targetTitles: ['Senior Backend Engineer', 'Staff Engineer'], skills: [{ name: 'Go', canonical: 'go', confirmed: true }, { name: 'Kubernetes', canonical: 'kubernetes' }, { name: 'PostgreSQL', canonical: 'postgresql' }], yearsExperience: 8, confirmedFacts: ['Used Terraform for AWS infrastructure at Acme'], applyDefaults: { noticePeriod: '30 days', currentLocation: 'Gurugram, IN', workAuthorization: 'Indian citizen' } } })

  // companies + boards (admin pages)
  const mk = async (name: string, domain: string, hq: string, tags: string[], tier: string, anchor = true) =>
    prisma.company.create({ data: { name, normalizedName: name.toLowerCase(), domain, hqCountry: hq, tags, anchor, status: 'watched', tier, manualTier: anchor ? 'hot' : null, discoveredVia: 'manual', lastProbedAt: new Date(Date.now() - 2 * 3600_000), qualityScore: 80, activePostings: 3, postingRate30d: 1.5 } })
  const gitlab = await mk('GitLab', 'gitlab.com', 'US', ['anchor', 'remote_first'], 'hot')
  const atlassian = await mk('Atlassian', 'atlassian.com', 'AU', ['anchor', 'big_tech'], 'hot')
  const adobe = await mk('Adobe', 'adobe.com', 'US', ['anchor', 'mnc', 'big_tech'], 'warm')
  const board = (companyId: string, atsType: string, slug: string, host: string, apiUrl: string, extra: Record<string, unknown> = {}) =>
    prisma.companyBoard.create({ data: { companyId, atsType, slug, host, apiUrl, costClass: 'cheap', queryScope: null, nextPollAt: new Date(Date.now() + 600_000), lastPollAt: new Date(Date.now() - 300_000), lastSuccessAt: new Date(Date.now() - 300_000), lastPostingCount: 12, ...extra } })
  await board(gitlab.id, 'greenhouse', 'gitlab', 'boards-api.greenhouse.io', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs')
  await board(atlassian.id, 'lever', 'atlassian', 'api.lever.co', 'https://api.lever.co/v0/postings/atlassian?mode=json')
  await board(adobe.id, 'workday', 'adobe', 'adobe.wd5.myworkdayjobs.com', 'https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs', { status: 'failing', consecutiveFailures: 4, lastError: 'HTTP 429 rate limited' })
  const source = await prisma.source.create({ data: { name: 'Remotive', domain: 'remotive.io', sourceType: 'job_board', ingestionMethod: 'api', qualityScore: 85, lastCrawledAt: new Date(Date.now() - 900_000) } })
  await prisma.source.create({ data: { name: 'We Work Remotely', domain: 'weworkremotely.com', sourceType: 'job_board', ingestionMethod: 'rss', qualityScore: 70, failureCount: 3, lastCrawledAt: new Date(Date.now() - 86_400_000) } })

  // jobs through the real ingestion path (classification + per-user evaluation)
  const raw = (title: string, company: string, location: string, description: string, fp: string, extra: Partial<RawJob> = {}): RawJob => ({ title, company, applyUrl: `https://jobs.example/${fp}/apply`, sourceUrl: `https://jobs.example/${fp}`, description, location, tags: [], sourceFingerprint: fp, sourceName: 'Remotive', ...extra })
  const ingest = async (r: RawJob) => {
    const feedKey = `source:${source.id}`
    await sightings.reconcile({ feedKey, sourceId: source.id, items: [{ externalId: r.sourceFingerprint! }], fullList: false })
    const res = await enricher.enrich({ feedKey, sourceId: source.id, externalId: r.sourceFingerprint!, raw: r, event: 'new' })
    if (res.status !== 'created' && res.status !== 'updated') throw new Error(`seed: ${r.title} was ${res.status}`)
    seeded.jobs[r.sourceFingerprint!] = res.jobId!
    return res
  }
  await ingest(raw(SAMPLE_JD_TITLE, 'Acme', 'Remote, Worldwide', SAMPLE_JD + '\n\nSalary: $150,000 - $190,000. Work from anywhere.', 'j1'))
  await ingest(raw('Staff Platform Engineer', 'GitLab', 'Remote, Worldwide', 'Fully remote, hire anywhere. Kubernetes, Go, Terraform, AWS. $180k–$220k.', 'j2'))
  await ingest(raw('Senior Software Engineer, Payments', 'Atlassian', 'Remote - India', 'TEAM Anywhere. Java, Kotlin, AWS. Work from India remotely. ₹45–60 LPA.', 'j3'))
  await ingest(raw('Backend Engineer', 'Adobe', 'Noida, Uttar Pradesh, India (Hybrid)', 'Hybrid, 3 days in office. Java, microservices.', 'j4'))
  await ingest(raw('Platform Engineer', 'Restricted Inc', 'Remote - US', 'US residents only. Go, AWS.', 'j5'))
  await ingest(raw('Data Engineer', 'TinyShop', 'Remote, Europe', 'EU time zones, contractors welcome. Python, Spark, Airflow.', 'j6', { employmentType: 'contract' } as any))
  await ingest(raw('Senior Node.js Engineer', 'BurstCo', 'Remote, Worldwide', 'Worldwide remote. Node.js, TypeScript, AWS.', 'j7'))
  await ingest(raw('Site Reliability Engineer', 'Remote First Co', 'Remote, Anywhere', 'Anywhere, async-first. Kubernetes, Prometheus, Go.', 'j8'))

  // resume → master version → requirements → report → suggestions (real scorer)
  const base = ResumeContentSchema.parse(SAMPLE_RESUME)
  const resume = await prisma.resume.create({ data: { userId: owner.id, label: 'Backend – master', isMaster: true, parseStatus: 'parsed', parseWarnings: [{ code: 'tables', severity: 'warn', message: 'A table was flattened; check the skills section.', penalty: 2 }], sourceFilename: 'asha-verma.pdf', rawText: 'ASHA VERMA\nSenior Backend Engineer\n…' } })
  const master = await prisma.resumeVersion.create({ data: { resumeId: resume.id, kind: 'master', content: base, contentHash: 'h0', renderStatus: 'none' } })
  await prisma.resume.update({ where: { id: resume.id }, data: { currentVersionId: master.id } })
  seeded.resumeId = resume.id; seeded.masterVersionId = master.id
  const reqs = analyzeJdDeterministic(SAMPLE_JD_TITLE, SAMPLE_JD)
  const j1 = seeded.jobs.j1
  await prisma.jobRequirements.create({ data: { jobId: j1, descriptionHash: 'd', extractorVersion: reqs.extractorVersion, required: reqs.required, preferred: reqs.preferred, keywords: reqs.keywords, titleNormalized: reqs.titleNormalized, seniority: reqs.seniority, yearsMin: reqs.yearsMin, llmUsed: false } })
  const breakdown = scoreResume(base, reqs)
  const report = await prisma.atsReport.create({ data: { resumeVersionId: master.id, jobId: j1, scorerVersion: 'ats-v1', score: breakdown.score, breakdown } })
  const missing = breakdown.missing.filter((m) => m.required).slice(0, 2)
  for (const m of missing) await prisma.suggestion.create({ data: { reportId: report.id, kind: 'skills_section', after: m.skill, rationale: `The JD requires ${m.skill}; your master never mentions it.`, jdEvidence: m.jdEvidence ?? null, skill: m.skill, status: 'pending', expectedGain: 4 } })
  await prisma.suggestion.create({ data: { reportId: report.id, kind: 'bullet_rewrite', targetPath: '/work/0/highlights/0', before: base.work[0].highlights[0], after: base.work[0].highlights[0] + ' (Go, PostgreSQL)', rationale: 'Name the stack the JD asks for where you already used it.', status: 'pending', expectedGain: 2, grounding: { ok: true, unsupported: [] } } })

  // per-user state through the real routes: one saved, one applied (with events), one rejected, one closed
  await call('POST', `/api/jobs/${seeded.jobs.j2}/save`)
  await call('POST', `/api/jobs/${seeded.jobs.j3}/apply`, { status: 'applied', followUpDays: 7 })
  await call('POST', `/api/jobs/${seeded.jobs.j5}/reject`)
  await prisma.job.update({ where: { id: seeded.jobs.j6 }, data: { status: 'closed', closedAt: new Date(Date.now() - 3600_000) } })
  // worker heartbeat so the admin pill is green
  await redis.set('jobradar:worker:heartbeat', JSON.stringify({ at: new Date().toISOString(), version: 'smoke', mode: 'inline' }))
}

// ── bridge: URL → apps/web/app/api/**/route.ts ────────────────────────────────────────────────────────────
function resolveRoute(pathname: string): { file: string; params: Record<string, string> } | null {
  const segs = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  let dir = API_ROOT
  const params: Record<string, string> = {}
  for (const s of segs) {
    const exact = join(dir, s)
    if (existsSync(exact) && statSync(exact).isDirectory()) { dir = exact; continue }
    const dyn = readdirSync(dir).find((d) => /^\[.+\]$/.test(d) && statSync(join(dir, d)).isDirectory())
    if (!dyn) return null
    params[dyn.slice(1, -1)] = decodeURIComponent(s)
    dir = join(dir, dyn)
  }
  const file = join(dir, 'route.ts')
  return existsSync(file) ? { file, params } : null
}

const modules = new Map<string, Promise<any>>()
const loadRoute = (file: string) => { if (!modules.has(file)) modules.set(file, import(pathToFileURL(file).href)); return modules.get(file)! }

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const r = resolveRoute(path.split('?')[0])
  if (!r) return { status: 404, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from(JSON.stringify({ error: `no route for ${path}` })) }
  const mod = await loadRoute(r.file)
  const handler = mod[method]
  if (!handler) return { status: 405, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from(JSON.stringify({ error: 'method not allowed' })) }
  setRequestContext({ cookies: {}, headers })
  const req = new NextRequest(`http://127.0.0.1:${PORT}${path}`, { method, body, headers })
  let res: any
  try { res = await handler(req as any, { params: Promise.resolve(r.params) }) } catch (e) {
    return { status: 500, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from(JSON.stringify({ error: (e as Error).message, stack: (e as Error).stack })) }
  }
  if (res instanceof Response) return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
  const h = new Headers(res.headers ?? {})
  const b = res.body
  if (b === null || b === undefined) return { status: res.status, headers: h, body: Buffer.alloc(0) }
  if (Buffer.isBuffer(b) || b instanceof Uint8Array) return { status: res.status, headers: h, body: Buffer.from(b) }
  if (typeof b === 'string') { if (!h.has('content-type')) h.set('content-type', 'text/plain'); return { status: res.status, headers: h, body: Buffer.from(b) } }
  if (!h.has('content-type')) h.set('content-type', 'application/json')
  return { status: res.status, headers: h, body: Buffer.from(JSON.stringify(b)) }
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>JobRadar smoke</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/smoke.css"></head><body class="antialiased"><div id="root"></div><script src="/bundle.js"></script></body></html>`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  try {
    if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync(BUNDLE)) }
    if (url.pathname === '/smoke.css') { const f = process.env.UI_SMOKE_CSS ?? '/tmp/ui-smoke/smoke.css'; res.writeHead(200, { 'content-type': 'text/css' }); return res.end(existsSync(f) ? readFileSync(f) : '') }
    if (url.pathname.startsWith('/api/')) {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const rawBody = Buffer.concat(chunks)
      const ct = req.headers['content-type'] ?? ''
      let body: unknown = undefined
      if (rawBody.length) {
        if (ct.includes('application/json')) body = JSON.parse(rawBody.toString())
        else if (ct.includes('multipart/form-data')) body = await new Response(rawBody, { headers: { 'content-type': ct } }).formData()
        else body = rawBody.toString()
      }
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
      const out = await call(req.method ?? 'GET', url.pathname + url.search, body, headers)
      const h: Record<string, string> = {}
      out.headers.forEach((v, k) => { if (k !== 'content-length') h[k] = v })
      res.writeHead(out.status, h)
      return res.end(out.body)
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(SHELL)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: (e as Error).message }))
  }
})

seed().then(() => new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))).then(() => {
  console.log(`ready ${PORT} ${JSON.stringify(seeded)}`)
}).catch((e) => { console.error(e); process.exit(1) })
process.on('SIGTERM', () => { server.close(); process.exit(0) })
