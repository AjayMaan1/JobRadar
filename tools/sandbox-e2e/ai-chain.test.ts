/**
 * E2E (simulated infra): the hosted free-tier chain in the real user flow (docs/AI-PROVIDERS.md §4, `--ai fast`).
 *   LLM_PROVIDER=cerebras,gemini,none · EMBEDDING_PROVIDER=gemini — every hosted endpoint is a fixture here.
 *   analysis → requirements (Cerebras, json_schema) → score → suggestions (Cerebras) → headline variants while
 *   Cerebras is rate-limited (falls over to Gemini) → answers + cover → embeddings via Gemini → /api/health chain.
 *   Also proves PII masking: no e-mail/phone from the resume ever reaches a hosted provider.
 *     tsx tools/testkit/run-tests.ts e2e-ai-chain tools/sandbox-e2e/ai-chain.test.ts
 */
process.env.AUTH_DISABLED = '1'
process.env.ADMIN_EMAIL = 'owner@sandbox.local'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'cerebras,gemini,none'
process.env.LLM_PII_PROVIDERS = 'cerebras,gemini'
process.env.CEREBRAS_API_KEY = 'cb-test-key'
process.env.GEMINI_API_KEY = 'gm-test-key'
process.env.EMBEDDING_PROVIDER = 'gemini'
process.env.LLM_CACHE = 'off'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = './data/sandbox-objects'
process.env.PDF_RENDERER = 'simple'

import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@jobradar/db'
import { NextRequest } from 'next/server'
import { FakeFetch } from '../testkit/fake-fetch.js'
import { ResumeContentSchema } from '@jobradar/resume'
import { SAMPLE_RESUME, SAMPLE_JD, SAMPLE_JD_TITLE } from '../../packages/resume/src/__fixtures__/sample.js'
import { POST as analysisPOST } from '../../apps/web/app/api/jobs/[id]/analysis/route.js'
import { GET as reportsGET } from '../../apps/web/app/api/jobs/[id]/reports/route.js'
import { POST as suggestionsPOST, GET as suggestionsGET } from '../../apps/web/app/api/analyses/[id]/suggestions/route.js'
import { POST as variantsPOST } from '../../apps/web/app/api/analyses/[id]/variants/route.js'
import { POST as answersPOST } from '../../apps/web/app/api/analyses/[id]/answers/route.js'
import { POST as coverPOST } from '../../apps/web/app/api/analyses/[id]/cover/route.js'
import { GET as kitGET } from '../../apps/web/app/api/jobs/[id]/apply-kit/route.js'
import { GET as taskGET } from '../../apps/web/app/api/tasks/[id]/route.js'
import { GET as healthGET } from '../../apps/web/app/api/health/route.js'

// ── hosted provider fixtures ───────────────────────────────────────────────────────────────────────────────
const http = new FakeFetch().install()
const seen: Array<{ provider: string; schema: string; model: string; body: any; auth: string | undefined }> = []
let cerebrasMode: 'ok' | '429' = 'ok'

/** Schema-aware answers for the purposes the flow exercises; generic JSON-Schema sampler for anything else. */
function answerFor(schemaName: string, schema: any): unknown {
  switch (schemaName) {
    case 'job_requirements':
      return { required: [{ skill: 'Go', weight: 0.9 }, { skill: 'Kubernetes', weight: 0.8 }, { skill: 'Kafka', weight: 0.7 }, { skill: 'PostgreSQL', weight: 0.6 }], preferred: [{ skill: 'Terraform', weight: 0.4 }, { skill: 'Python', weight: 0.3 }], keywords: [{ term: 'payments', weight: 0.8 }, { term: 'event-driven', weight: 0.6 }], yearsMin: 6, seniority: 'senior', titleNormalized: 'Senior Backend Engineer' }
    case 'proposals':
      return { proposals: [{ kind: 'bullet_rewrite', targetPath: '/work/0/highlights/0', after: 'Built an event-driven order pipeline in Go on Kubernetes handling 2M events/day', rationale: 'Leads with the outcome and names the stack the posting asks for.', jdEvidence: 'Own backend services written in Go and deployed on Kubernetes' }] }
    case 'variants':
      return { variants: [{ variant: 'balanced', text: 'Senior Software Engineer · Go, Kubernetes, PostgreSQL' }] }
    case 'answers':
      return { answers: [{ question: 'Why are you interested in this role and what makes you a strong fit?', answer: 'I have built event-driven order pipelines in Go on Kubernetes and reduced PostgreSQL p99 latency by 40%, which maps directly to this role.', skip: false }] }
    case 'cover_letter':
      return { letter: 'Hiring team,\n\nI build distributed systems in Go and Java for fintech and SaaS companies and would like to bring that to your backend team.\n\nJane', usedFacts: [] }
    default:
      return sample(schema)
  }
}
function sample(s: any): unknown {
  if (!s || typeof s !== 'object') return 'x'
  if (s.const !== undefined) return s.const
  if (s.enum) return s.enum[0]
  if (s.anyOf) return sample(s.anyOf.find((x: any) => x.type !== 'null') ?? s.anyOf[0])
  switch (s.type) {
    case 'string': return 'sample'
    case 'number': case 'integer': return s.minimum ?? 0
    case 'boolean': return false
    case 'array': return s.minItems ? Array.from({ length: s.minItems }, () => sample(s.items)) : []
    case 'object': return Object.fromEntries((s.required ?? Object.keys(s.properties ?? {})).map((k: string) => [k, sample(s.properties?.[k])]))
    default: return null
  }
}
function chatHandler(provider: string) {
  return (req: { body?: string; headers: Record<string, string> }) => {
    const body = JSON.parse(req.body ?? '{}')
    const rf = body.response_format ?? {}
    const schemaName: string = rf.json_schema?.name ?? (body.messages?.[0]?.content?.match(/"title":"?(\w+)/)?.[1] ?? 'unknown')
    seen.push({ provider, schema: schemaName, model: body.model, body, auth: req.headers.authorization })
    if (provider === 'cerebras' && cerebrasMode === '429') return { status: 429, headers: { 'retry-after': '120' }, body: { error: { message: 'rate limit exceeded' } } }
    const data = answerFor(schemaName, rf.json_schema?.schema)
    return { status: 200, body: { id: 'c1', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify(data) } }], usage: { prompt_tokens: 900, completion_tokens: 300 } } }
  }
}
/** Deterministic 768-d "embeddings": hashed bag of words, so related texts are similar. */
function embedHandler(req: { body?: string }) {
  const { input } = JSON.parse(req.body ?? '{}') as { input: string[] }
  const data = input.map((t, index) => {
    const v = new Array(768).fill(0)
    for (const w of t.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean)) { let h = 2166136261; for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619); v[Math.abs(h) % 768] += 1 }
    return { index, embedding: v }
  })
  return { status: 200, body: { data, model: 'text-embedding-004', usage: { prompt_tokens: 10, total_tokens: 10 } } }
}
http.route('https://api.cerebras.ai/v1/chat/completions', chatHandler('cerebras'))
http.route('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', chatHandler('gemini'))
http.route('https://generativelanguage.googleapis.com/v1beta/openai/embeddings', embedHandler)
http.route(/\/v1\/models$|\/openai\/models$/, { status: 200, body: { data: [{ id: 'llama-3.3-70b' }, { id: 'gemini-2.0-flash' }] } })

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const json = async (r: any) => r.json()
const P = (id: string) => ({ params: Promise.resolve({ id }) })
const waitTask = async (id: string) => { for (let i = 0; i < 100; i++) { const t = await json(await taskGET(new NextRequest(`http://local/api/tasks/${id}`) as any, P(id))); if (t.status === 'done' || t.status === 'failed') return t; await new Promise((r) => setTimeout(r, 50)) } throw new Error('task timeout') }
const PII = [SAMPLE_RESUME.basics.email!, SAMPLE_RESUME.basics.phone!.replace(/\s/g, ''), SAMPLE_RESUME.basics.phone!]
const leaks = (rows: typeof seen) => rows.filter((r) => { const s = JSON.stringify(r.body).replace(/\s/g, ''); return PII.some((p) => s.includes(p.replace(/\s/g, ''))) })

let owner: { id: string }, job: { id: string }, masterVersion: { id: string }, reportId = ''

describe('E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow', () => {
  beforeAll(async () => {
    owner = await prisma.user.create({ data: { email: 'owner@sandbox.local', role: 'admin', lastLoginAt: new Date() } })
    await prisma.candidateProfile.create({ data: { userId: owner.id, headline: 'Senior Software Engineer', skills: [{ name: 'Go', canonical: 'go' }, { name: 'Kubernetes', canonical: 'kubernetes' }], targetTitles: ['Senior Backend Engineer'], confirmedFacts: [], applyDefaults: { noticePeriod: '30 days' } } })
    const base = ResumeContentSchema.parse(SAMPLE_RESUME)
    const resume = await prisma.resume.create({ data: { userId: owner.id, label: 'master', isMaster: true, parseStatus: 'parsed', parseWarnings: [] } })
    masterVersion = await prisma.resumeVersion.create({ data: { resumeId: resume.id, kind: 'master', content: base, contentHash: 'h0' } })
    await prisma.resume.update({ where: { id: resume.id }, data: { currentVersionId: masterVersion.id } })
    job = await prisma.job.create({ data: { title: SAMPLE_JD_TITLE, company: 'Acme', sourceName: 's', skills: '[]', canonicalHash: 'c1', description: SAMPLE_JD, status: 'new', applyUrl: 'https://boards.greenhouse.io/acme/jobs/4012345' } })
  })

  it('1. analysis: requirements come from Cerebras with a JSON-schema request and a bearer key; the report is scored with them', async () => {
    const res = await analysisPOST(new NextRequest(`http://local/api/jobs/${job.id}/analysis`, { method: 'POST', body: { resumeVersionId: masterVersion.id } }) as any, P(job.id))
    expect(res.status).toBe(202)
    const t = await waitTask((await json(res)).taskId)
    expect(t.status).toBe('done')
    const r = await json(await reportsGET(new NextRequest(`http://local/api/jobs/${job.id}/reports`) as any, P(job.id)))
    expect(r.report).toBeTruthy()
    reportId = r.report.id
    expect(r.report.requirements.llmUsed).toBe(true)
    expect(r.report.requirements.required.map((x: any) => x.skill)).toEqual(expect.arrayContaining(['Go', 'Kubernetes', 'Kafka']))
    expect(r.report.score).toBeGreaterThan(50)
    const call = seen.find((s) => s.schema === 'job_requirements')!
    expect(call.provider).toBe('cerebras')
    expect(call.model).toBe('llama-3.3-70b')
    expect(call.auth).toBe('Bearer cb-test-key')
    expect(call.body.response_format.type).toBe('json_schema')
    expect(call.body.response_format.json_schema.schema.properties.required.type).toBe('array')
    expect(call.body.messages[1].content).toContain('<untrusted')
  })

  it('2. suggestions: the proposal from Cerebras is grounded and stored as a pending suggestion', async () => {
    const res = await suggestionsPOST(new NextRequest(`http://local/api/analyses/${reportId}/suggestions`, { method: 'POST', body: {} }) as any, P(reportId))
    expect(res.status).toBe(202)
    const t = await waitTask((await json(res)).taskId)
    expect(t.status).toBe('done')
    expect(t.result.llmUsed).toBe(true)
    const list = await json(await suggestionsGET(new NextRequest(`http://local/api/analyses/${reportId}/suggestions`) as any, P(reportId)))
    const rewrite = list.data.find((s: any) => s.kind === 'bullet_rewrite')
    expect(rewrite).toBeTruthy()
    expect(rewrite.targetPath).toBe('/work/0/highlights/0')
    expect(rewrite.status).toBe('pending')
    expect(rewrite.grounding.ok).toBe(true)
    expect(seen.filter((s) => s.schema === 'proposals').every((s) => s.provider === 'cerebras')).toBe(true)
  })

  it('3. fail-over: Cerebras returns 429 → the chain serves headline variants from Gemini without the user noticing', async () => {
    cerebrasMode = '429'
    const before = seen.length
    const res = await variantsPOST(new NextRequest(`http://local/api/analyses/${reportId}/variants`, { method: 'POST', body: { kind: 'headline', tone: 'balanced' } }) as any, P(reportId))
    expect(res.status).toBe(202)
    const t = await waitTask((await json(res)).taskId)
    expect(t.status).toBe('done')
    expect(t.result.variants).toBeGreaterThanOrEqual(1)
    const calls = seen.slice(before).filter((s) => s.schema === 'variants')
    expect(calls.map((c) => c.provider)).toEqual(['cerebras', 'gemini']) // one 429, then Gemini answered
    expect(calls[1].auth).toBe('Bearer gm-test-key')
    expect(calls[1].model).toBe('gemini-2.0-flash')
    const list = await json(await suggestionsGET(new NextRequest(`http://local/api/analyses/${reportId}/suggestions`) as any, P(reportId)))
    expect(list.data.some((s: any) => s.kind === 'headline')).toBe(true)
  })

  it('4. while Cerebras is cooling down, answers + cover note go straight to Gemini and land in the Apply Kit', async () => {
    const before = seen.length
    const a = await waitTask((await json(await answersPOST(new NextRequest(`http://local/api/analyses/${reportId}/answers`, { method: 'POST', body: {} }) as any, P(reportId)))).taskId)
    expect(a.status).toBe('done')
    const c = await waitTask((await json(await coverPOST(new NextRequest(`http://local/api/analyses/${reportId}/cover`, { method: 'POST', body: { tone: 'balanced' } }) as any, P(reportId)))).taskId)
    expect(c.status).toBe('done')
    const calls = seen.slice(before)
    expect(calls.some((x) => x.schema === 'answers' && x.provider === 'gemini')).toBe(true)
    expect(calls.some((x) => x.schema === 'cover_letter' && x.provider === 'gemini')).toBe(true)
    // Cerebras was NOT retried for these: the chain's per-provider quota/cooldown remembered the 429
    expect(calls.filter((x) => x.provider === 'cerebras').length).toBe(0)
    const kit = await json(await kitGET(new NextRequest(`http://local/api/jobs/${job.id}/apply-kit`) as any, P(job.id)))
    expect(kit.answers.length).toBeGreaterThanOrEqual(1)
    expect(kit.answers[0].answer).toMatch(/event-driven/)
    expect(kit.coverLetter?.text).toMatch(/Hiring team/)
    cerebrasMode = 'ok'
  })

  it('5. privacy floor holds even with privacy "not a concern": contact details never reach a hosted provider', async () => {
    expect(seen.length).toBeGreaterThanOrEqual(5)
    expect(leaks(seen)).toEqual([])
    // the resume projection sent for proposals carries no name/contact block at all — only the text being improved
    const proposals = seen.find((s) => s.schema === 'proposals')!
    const sent = JSON.stringify(proposals.body)
    expect(sent).toContain('<untrusted source=\\"resume_json\\">')
    expect(sent).not.toMatch(/Jane Doe|jane\.doe|"email"|"phone"/)
  })

  it('6. embeddings via Gemini: job chunks embedded with text-embedding-004 (768 dims), fit computed for the user', async () => {
    const { services } = await import('../../apps/web/lib/services.js')
    const { inline } = services()
    await inline!.queue('embed').add('embed', { type: 'job', jobId: job.id })
    await inline!.queue('embed').add('embed', { type: 'profile', userId: owner.id })
    for (let i = 0; i < 60 && inline!.pending.count > 0; i++) await new Promise((r) => setTimeout(r, 50))
    const rows = await prisma.embedding.findMany({ where: { ownerType: 'job', ownerId: job.id } })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r: any) => r.model === 'text-embedding-004' && r.dims === 768)).toBe(true)
    expect(http.requests.filter((r) => r.url.endsWith('/openai/embeddings')).length).toBeGreaterThan(0)
    expect(await prisma.jobFit.count({ where: { userId: owner.id, jobId: job.id } })).toBe(1)
  })

  it('7. /api/health describes the chain: both hosted, PII-allowed by the operator, quota used today on Cerebras and Gemini', async () => {
    const h = await json(await healthGET(new NextRequest('http://local/api/health') as any))
    const ai = h.v3.ai
    expect(ai.configured).toEqual(['cerebras', 'gemini', 'none'])
    expect(ai.providers.map((p: any) => p.name)).toEqual(['cerebras', 'gemini'])
    for (const p of ai.providers) { expect(p.kind).toBe('cloud'); expect(p.piiAllowed).toBe(true); expect(p.reachable).toBe(true) }
    expect(ai.providers[0].quota.usedToday).toBeGreaterThanOrEqual(2)
    expect(ai.providers[1].quota.usedToday).toBeGreaterThanOrEqual(3)
    expect(ai.providers[0].dataUse).toBe('no-train')
    expect(ai.providers[1].dataUse).toBe('may-train')
    expect(h.v3.llm === null || typeof h.v3.llm === 'object').toBe(true)
  })
})
