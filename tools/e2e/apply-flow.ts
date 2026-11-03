import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { prisma } from '@jobradar/db'
import { renderSimplePdf } from '@jobradar/resume'
import { SAMPLE_JD, SAMPLE_JD_TITLE, SAMPLE_RESUME } from '../../packages/resume/src/__fixtures__/sample.js'

/**
 * End-to-end "apply from the portal" flow over HTTP against a running web app:
 *   login → upload resume → parse → review/edit → analyse → suggestions → confirm/accept → tailored version →
 *   render (PDF + DOCX) → apply kit → mark applied → pipeline status → search fallback → cleanup
 * Works with LLM_PROVIDER=none (deterministic paths) and with a local model. Writes reports/e2e-apply-flow.{md,json}.
 *
 *   BASE_URL=http://localhost:3000 E2E_EMAIL=… E2E_PASSWORD=… pnpm verify:e2e
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const EMAIL = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL ?? 'owner@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? ''

interface Step { n: number; name: string; ok: boolean; ms: number; detail: string }
const steps: Step[] = []
let cookie = ''

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; json: T; res: Response }> {
  const init: RequestInit = { method, headers: { cookie, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, redirect: 'manual' }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const json = raw ? ({} as T) : ((await res.json().catch(() => ({}))) as T)
  return { status: res.status, json, res }
}

async function waitTask(id: string, timeoutMs = 20 * 60_000): Promise<{ status: string; result: Record<string, unknown> | null; error: string | null }> {
  const started = Date.now()
  for (;;) {
    const { json } = await api<{ status: string; result: Record<string, unknown> | null; error: string | null }>('GET', `/api/tasks/${id}`)
    if (json.status === 'done' || json.status === 'failed') return json
    if (Date.now() - started > timeoutMs) throw new Error(`task ${id} timed out`)
    await new Promise((r) => setTimeout(r, 700))
  }
}

async function step(name: string, fn: () => Promise<string>): Promise<void> {
  const n = steps.length + 1
  const t = Date.now()
  try {
    const detail = await fn()
    steps.push({ n, name, ok: true, ms: Date.now() - t, detail })
    console.log(`  ✓ ${n}. ${name} — ${detail} (${Date.now() - t} ms)`)
  } catch (err) {
    steps.push({ n, name, ok: false, ms: Date.now() - t, detail: (err as Error).message })
    console.log(`  ✗ ${n}. ${name} — ${(err as Error).message}`)
    throw err
  }
}

async function main() {
  console.log(`E2E apply flow against ${BASE} as ${EMAIL}`)
  const tag = Date.now()
  let jobId = ''
  let resumeId = ''
  let versionId = ''
  let reportId = ''
  let tailoredId = ''
  const ctx: Record<string, unknown> = {}

  try {
    await step('seed a job posting (DB)', async () => {
      const job = await prisma.job.create({ data: { title: SAMPLE_JD_TITLE, company: 'Acme Payments', sourceName: 'e2e', sourceType: 'company_board', skills: '["Engineering"]', description: SAMPLE_JD, canonicalHash: `e2e-${tag}`, opportunityClass: 'p1_global_remote', employmentType: 'full_time', applyUrl: 'https://boards.greenhouse.io/acme/jobs/123456', eligibility: 'worldwide', remoteType: 'remote' } })
      jobId = job.id
      return `job ${job.id}`
    })

    await step('sign in', async () => {
      const r = await api<{ user?: { email: string; role: string }; error?: string }>('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
      expect(r.status === 200 && r.json.user, `login failed (${r.status}): ${r.json.error ?? ''}`)
      expect(cookie.startsWith('jr_session='), 'session cookie not set')
      return `${r.json.user!.email} (${r.json.user!.role})`
    })

    await step('unauthenticated request is rejected', async () => {
      const saved = cookie
      cookie = ''
      const r = await api('GET', '/api/resumes')
      cookie = saved
      expect(r.status === 401, `expected 401, got ${r.status}`)
      return '401 without cookie'
    })

    await step('upload resume (PDF)', async () => {
      const pdf = renderSimplePdf(SAMPLE_RESUME)
      const fd = new FormData()
      fd.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'jane-doe.pdf')
      fd.set('label', `E2E master ${tag}`)
      const r = await api<{ resume: { id: string; isMaster: boolean }; taskId: string; error?: string }>('POST', '/api/resumes', fd)
      expect(r.status === 202, `upload failed (${r.status}): ${r.json.error ?? ''}`)
      resumeId = r.json.resume.id
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `parse failed: ${t.error}`)
      return `resume ${resumeId} · status ${t.result?.status} · ${t.result?.warnings} warning(s)`
    })

    await step('parsed resume is structured (review screen data)', async () => {
      const r = await api<{ resume: { parseStatus: string; rawText: string | null }; current: { id: string; kind: string; content: { basics: { name: string; email?: string }; work: Array<{ position: string; name: string; highlights: string[] }>; skills: Array<{ keywords: string[] }> } } }>('GET', `/api/resumes/${resumeId}`)
      expect(r.status === 200 && r.json.current, 'resume detail missing')
      const c = r.json.current.content
      expect(c.basics.name === 'Jane Doe', `name parsed as "${c.basics.name}"`)
      expect(c.basics.email === 'jane.doe@example.com', 'email not parsed')
      expect(c.work.length >= 2 && c.work[0].highlights.length >= 3, `work entries: ${c.work.length}`)
      expect(c.skills.reduce((a, g) => a + g.keywords.length, 0) >= 5, 'skills not parsed')
      versionId = r.json.current.id
      ctx.parsed = { name: c.basics.name, work: c.work.map((w) => `${w.position} @ ${w.name} (${w.highlights.length})`), skills: c.skills.reduce((a, g) => a + g.keywords.length, 0) }
      return `${c.work.length} roles, ${ctx.parsed && (ctx.parsed as { skills: number }).skills} skills, raw text ${r.json.resume.rawText?.length ?? 0} chars`
    })

    await step('edit resume (user correction → new immutable version)', async () => {
      const before = await api<{ current: { content: Record<string, unknown> & { basics: Record<string, unknown> } } }>('GET', `/api/resumes/${resumeId}`)
      const content = structuredClone(before.json.current.content)
      content.basics.label = 'Senior Software Engineer'
      content.basics.summary = 'Backend engineer with 7 years building distributed systems in Go and Java for fintech and SaaS companies.'
      const r = await api<{ versionId: string; error?: string }>('PATCH', `/api/resumes/${resumeId}`, { content })
      expect(r.status === 200 && r.json.versionId, `correction failed: ${r.json.error ?? r.status}`)
      const after = await api<{ current: { id: string; kind: string }; versions: Array<{ kind: string }> }>('GET', `/api/resumes/${resumeId}`)
      expect(after.json.current.id === r.json.versionId && after.json.current.kind === 'correction', 'current version not the correction')
      expect(after.json.versions.length === 2, `expected 2 versions, got ${after.json.versions.length}`)
      versionId = r.json.versionId
      return `version ${versionId} (correction); original parse kept`
    })

    await step('profile seeded from master resume', async () => {
      const r = await api<{ profile: { headline: string | null; skills: Array<{ canonical: string }> } | null }>('GET', '/api/profile')
      expect(r.json.profile && r.json.profile.skills.length >= 5, 'profile not seeded')
      return `headline "${r.json.profile!.headline}" · ${r.json.profile!.skills.length} skills`
    })

    await step('analyse match (ats-v1)', async () => {
      const r = await api<{ taskId: string; error?: string; code?: string }>('POST', `/api/jobs/${jobId}/analysis`, { resumeVersionId: versionId })
      expect(r.status === 202, `analysis not queued (${r.status}): ${r.json.error ?? ''}`)
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `analysis failed: ${t.error}`)
      reportId = String(t.result?.reportId)
      const rep = await api<{ score: number; breakdown: { components: Record<string, { points: number; max: number }>; missing: Array<{ skill: string; required: boolean }>; matched: unknown[] } }>('GET', `/api/analyses/${reportId}`)
      expect(rep.status === 200 && rep.json.score > 40, `unexpected score ${rep.json.score}`)
      ctx.report = { score: rep.json.score, components: Object.fromEntries(Object.entries(rep.json.breakdown.components).map(([k, c]) => [k, `${c.points}/${c.max}`])), missingRequired: rep.json.breakdown.missing.filter((m) => m.required).map((m) => m.skill) }
      return `score ${rep.json.score} · matched ${rep.json.breakdown.matched.length} · missing required ${rep.json.breakdown.missing.filter((m) => m.required).length}`
    })

    await step('latest report is available for the job', async () => {
      const r = await api<{ report: { id: string; score: number } | null }>('GET', `/api/jobs/${jobId}/reports`)
      expect(r.json.report?.id === reportId, 'latest report mismatch')
      return `report ${reportId}`
    })

    let acceptedIds: string[] = []
    await step('generate suggestions (grounded)', async () => {
      const r = await api<{ taskId: string }>('POST', `/api/analyses/${reportId}/suggestions`)
      expect(r.status === 202, 'suggestions not queued')
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `suggestions failed: ${t.error}`)
      const list = await api<{ data: Array<{ id: string; kind: string; status: string; flagged: boolean; expectedGain: number | null; skill: string | null }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      const kinds = list.json.data.reduce<Record<string, number>>((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {})
      expect(list.json.data.length > 0, 'no suggestions produced')
      expect(list.json.data.every((s) => s.status === 'pending'), 'suggestions must start pending (user discretion)')
      ctx.suggestions = kinds
      return Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(', ')
    })

    await step('accept a suggestion; reject one; edit one (re-validated)', async () => {
      const list = await api<{ data: Array<{ id: string; kind: string; after: string | null; before: string | null }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      const changes = list.json.data.filter((s) => ['skills_section', 'bullet_rewrite', 'reorder'].includes(s.kind))
      expect(changes.length >= 1, 'no applicable change suggestions')
      const a = await api<{ status: string }>('PATCH', `/api/suggestions/${changes[0].id}`, { status: 'accepted' })
      expect(a.json.status === 'accepted', 'accept failed')
      acceptedIds.push(changes[0].id)
      let detail = `accepted ${changes[0].kind}`
      if (changes[1]) {
        const rj = await api<{ status: string }>('PATCH', `/api/suggestions/${changes[1].id}`, { status: 'rejected' })
        expect(rj.json.status === 'rejected', 'reject failed')
        detail += `, rejected ${changes[1].kind}`
      }
      const editable = changes.find((s) => s.kind === 'bullet_rewrite')
      if (editable) {
        const ed = await api<{ status: string; flagged: boolean; grounding: { ok: boolean } }>('PATCH', `/api/suggestions/${editable.id}`, { status: 'edited', userEdit: `${editable.before ?? editable.after} (edited)` })
        expect(ed.json.status === 'edited', 'edit failed')
        acceptedIds.push(editable.id)
        detail += `, edited bullet (grounded: ${ed.json.grounding?.ok})`
      }
      return detail
    })

    await step('fabrication guard: an edit adding an unsupported claim is flagged', async () => {
      const list = await api<{ data: Array<{ id: string; kind: string; after: string | null }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      const s = list.json.data.find((x) => x.kind === 'skills_section')
      expect(s, 'no skills_section suggestion to test with')
      const ed = await api<{ flagged: boolean; grounding: { ok: boolean; unsupported: Array<{ value: string }> } }>('PATCH', `/api/suggestions/${s!.id}`, { status: 'edited', userEdit: `${s!.after}, Rust, Google Cloud Certified Architect` })
      expect(ed.json.flagged === true, 'unsupported claim was not flagged')
      // restore to the honest accepted state
      await api('PATCH', `/api/suggestions/${s!.id}`, { status: 'accepted' })
      return `flagged: ${ed.json.grounding.unsupported.map((u) => u.value).join(', ')}`
    })

    await step('confirm a missing-skill question (yes + context → confirmed fact + follow-ups)', async () => {
      const list = await api<{ data: Array<{ id: string; kind: string; skill: string | null; status: string }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      const q = list.json.data.find((s) => s.kind === 'keyword_confirm' && s.status === 'pending')
      if (!q) return 'no open questions (all required skills already evidenced)'
      const r = await api<{ suggestion: { status: string }; created: Array<{ kind: string }>; taskId: string | null }>('POST', `/api/suggestions/${q.id}/confirm-fact`, { yes: true, context: `Used ${q.skill} daily at Acme Payments for dashboards and alerting on the order pipeline.` })
      expect(r.json.suggestion.status === 'answered', 'question not marked answered')
      if (r.json.taskId) await waitTask(r.json.taskId)
      const prof = await api<{ profile: { confirmedFacts?: string[] } }>('GET', '/api/profile')
      expect((prof.json.profile.confirmedFacts ?? []).some((f) => f.startsWith(`${q.skill}:`)), 'confirmed fact not recorded')
      const after = await api<{ data: Array<{ id: string; kind: string; skill: string | null; status: string }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      const add = after.json.data.find((s) => s.kind === 'skills_section' && s.skill === q.skill && s.status === 'pending')
      if (add) { await api('PATCH', `/api/suggestions/${add.id}`, { status: 'accepted' }); acceptedIds.push(add.id) }
      return `${q.skill} confirmed · ${r.json.created.length} follow-up suggestion(s)`
    })

    await step('opt-in headline variants are OFF unless requested', async () => {
      const list = await api<{ data: Array<{ kind: string }> }>('GET', `/api/analyses/${reportId}/suggestions`)
      expect(!list.json.data.some((s) => s.kind === 'headline' || s.kind === 'about'), 'variants generated without opt-in')
      return 'no headline/about variants exist'
    })

    await step('generate tailored version + render PDF/DOCX (verified, re-scored)', async () => {
      const r = await api<{ versionId: string; taskId: string; error?: string }>('POST', '/api/resume-versions', { baseVersionId: versionId, jobId, acceptedSuggestionIds: acceptedIds, headline: 'Senior Backend Engineer · Go, Kubernetes, Kafka' })
      expect(r.status === 202, `version not created: ${r.json.error ?? r.status}`)
      tailoredId = r.json.versionId
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `render failed: ${t.error}`)
      const v = await api<{ kind: string; renderStatus: string; tailoredHeadline: boolean; renderWarnings: Array<{ code: string }> | null; changeLog: { changes: unknown[]; scoreBefore: number | null; scoreAfter: number | null; renderer?: string } }>('GET', `/api/resume-versions/${tailoredId}`)
      expect(v.json.kind === 'tailored' && v.json.renderStatus === 'rendered', `render status ${v.json.renderStatus}`)
      expect(v.json.tailoredHeadline === true, 'tailored headline flag missing')
      expect((v.json.changeLog.changes?.length ?? 0) >= acceptedIds.length, 'change log incomplete')
      ctx.render = { changes: v.json.changeLog.changes.length, scoreBefore: v.json.changeLog.scoreBefore, scoreAfter: v.json.changeLog.scoreAfter, renderer: v.json.changeLog.renderer, warnings: (v.json.renderWarnings ?? []).map((w) => w.code) }
      return `${v.json.changeLog.changes.length} change(s) · score ${v.json.changeLog.scoreBefore} → ${v.json.changeLog.scoreAfter} · renderer ${v.json.changeLog.renderer} · warnings ${(v.json.renderWarnings ?? []).map((w) => w.code).join(',') || 'none'}`
    })

    await step('download rendered PDF and DOCX via signed links', async () => {
      for (const fmt of ['pdf', 'docx'] as const) {
        const r = await api('GET', `/api/resume-versions/${tailoredId}/file?fmt=${fmt}`, undefined, true)
        expect(r.status === 302, `${fmt}: expected redirect, got ${r.status}`)
        const loc = r.res.headers.get('location')!
        const file = await fetch(loc.startsWith('http') ? loc : `${BASE}${loc}`, { headers: { cookie } })
        expect(file.status === 200, `${fmt} download ${file.status}`)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const magic = String.fromCharCode(...bytes.slice(0, 4))
        expect(fmt === 'pdf' ? magic.startsWith('%PDF') : magic.startsWith('PK'), `${fmt} magic bytes wrong: ${magic}`)
        ctx[`${fmt}Bytes`] = bytes.length
      }
      return `pdf ${ctx.pdfBytes} bytes · docx ${ctx.docxBytes} bytes`
    })

    await step('tailored version shows the master text unchanged on the profile', async () => {
      const prof = await api<{ profile: { headline: string | null } }>('GET', '/api/profile')
      expect(prof.json.profile.headline !== 'Senior Backend Engineer · Go, Kubernetes, Kafka', 'master headline was modified by tailoring')
      return `master headline still "${prof.json.profile.headline}"`
    })

    await step('apply kit lists the tailored version, files and copy texts', async () => {
      const k = await api<{ job: { ats: string; applyUrl: string }; version: { id: string } | null; files: { pdf: string | null; docx: string | null }; texts: { headline: string | null; headlineIsTailored: boolean }; application: unknown }>('GET', `/api/jobs/${jobId}/apply-kit`)
      expect(k.json.version?.id === tailoredId, 'kit does not reference the tailored version')
      expect(k.json.files.pdf && k.json.files.docx, 'kit files missing')
      expect(k.json.texts.headlineIsTailored && k.json.texts.headline?.includes('Kafka'), 'tailored headline not in kit')
      expect(k.json.application === null, 'application should not exist yet')
      return `ats ${k.json.job.ats} · headline "${k.json.texts.headline}"`
    })

    await step('draft application answers', async () => {
      const r = await api<{ taskId: string }>('POST', `/api/analyses/${reportId}/answers`)
      expect(r.status === 202, 'answers not queued')
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `answers failed: ${t.error}`)
      const k = await api<{ answers: Array<{ question: string | null; answer: string | null }> }>('GET', `/api/jobs/${jobId}/apply-kit`)
      return `${k.json.answers.length} drafted answer(s)${k.json.answers.length ? ` — "${k.json.answers[0].question}"` : ' (no LLM → profile-based only)'}`
    })

    await step('mark applied with the exact artifacts sent', async () => {
      const r = await api<{ userState: string; application: { status: string; resumeVersionId: string; headlineUsed: string; events: unknown[] } }>('POST', `/api/jobs/${jobId}/apply`, { resumeVersionId: tailoredId, headlineUsed: 'Senior Backend Engineer · Go, Kubernetes, Kafka', answers: [{ question: 'Why Acme?', answer: 'Payments infrastructure at scale.' }], coverNote: 'Sent via JobRadar e2e' })
      expect(r.status === 200 && r.json.userState === 'applied', 'apply failed')
      expect(r.json.application.resumeVersionId === tailoredId, 'application not linked to the tailored version')
      expect(r.json.application.events.length === 1, 'event timeline missing')
      return `application ${r.json.application.status} · version ${tailoredId.slice(0, 8)} · headline recorded`
    })

    await step('applied tab + pipeline status change', async () => {
      const tab = await api<{ data: Array<{ id: string; application: { status: string; resumeVersionId: string | null } | null }> }>('GET', '/api/jobs?tab=applied&limit=50')
      const row = tab.json.data.find((j) => j.id === jobId)
      expect(row?.application?.resumeVersionId === tailoredId, 'job missing from Applied tab with artifacts')
      const browse = await api<{ data: Array<{ id: string }> }>('GET', '/api/jobs?tab=browse&limit=100')
      expect(!browse.json.data.some((j) => j.id === jobId), 'applied job still in the inbox')
      const up = await api<{ application: { status: string; events: unknown[] } }>('POST', `/api/jobs/${jobId}/apply`, { status: 'interviewing', note: 'Recruiter screen booked' })
      expect(up.json.application.status === 'interviewing' && up.json.application.events.length === 2, 'status change not recorded')
      return 'in Applied tab, hidden from inbox, moved to Interviewing'
    })

    await step('search fallback: role synonyms expand the query', async () => {
      const r = await api<{ data: Array<{ id: string }>; expandedTerms?: string[]; hybrid?: boolean }>('GET', `/api/jobs?tab=applied&q=${encodeURIComponent('software engineer')}&limit=50`)
      expect((r.json.expandedTerms ?? []).includes('sde'), `expansion missing: ${(r.json.expandedTerms ?? []).join(',')}`)
      expect(r.json.data.some((j) => j.id === jobId), 'job not found via synonym-expanded search')
      const miss = await api<{ data: Array<{ id: string }> }>('GET', `/api/jobs?tab=applied&q=${encodeURIComponent('receptionist')}&limit=50`)
      expect(!miss.json.data.some((j) => j.id === jobId), 'unrelated query matched')
      return `"software engineer" → +${r.json.expandedTerms!.length} terms, found the job (hybrid=${Boolean(r.json.hybrid)})`
    })

    // ── v4 (audit) ──────────────────────────────────────────────────────────────────────────────────
    await step('v4: cover note is drafted, grounded and stored as a suggestion', async () => {
      const r = await api<{ taskId: string }>('POST', `/api/analyses/${reportId}/cover`, { tone: 'balanced' })
      expect(r.status === 202, `cover ${r.status}`)
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `cover task ${t.status}: ${t.error}`)
      const kit = await api<{ coverLetter: { text: string; flagged: boolean } | null }>('GET', `/api/jobs/${jobId}/apply-kit`)
      expect(Boolean(kit.json.coverLetter?.text), 'no cover note in the kit')
      return `${kit.json.coverLetter!.text.split(/\s+/).length} words · flagged=${kit.json.coverLetter!.flagged}`
    })

    await step('v4: follow-up reminder scheduled with the application', async () => {
      const r = await api<{ application: { followUpAt: string | null } }>('POST', `/api/jobs/${jobId}/apply`, { status: 'applied', followUpInDays: 7 })
      expect(Boolean(r.json.application.followUpAt), 'followUpAt not set')
      const cleared = await api<{ application: { followUpAt: string | null } }>('POST', `/api/jobs/${jobId}/apply`, { status: 'applied', followUpAt: null })
      expect(cleared.json.application.followUpAt === null, 'followUpAt not cleared')
      return `reminder set for ${r.json.application.followUpAt!.slice(0, 10)}, then cleared`
    })

    await step('v4: pasting a JD over a job that already has one is refused (NEW-03)', async () => {
      const r = await api<{ code?: string }>('POST', `/api/jobs/${jobId}/jd`, { description: 'x'.repeat(300) })
      expect(r.status === 409 && r.json.code === 'has_description', `expected 409 has_description, got ${r.status}`)
      return 'crawled description protected'
    })

    await step('v4: sessions list + alert channel + export', async () => {
      const sessions = await api<{ data: Array<{ current: boolean }> }>('GET', '/api/auth/sessions')
      expect(sessions.json.data.some((x) => x.current), 'current session not listed')
      const ch = await api<{ id: string; kind: string }>('POST', '/api/alert-channels', { kind: 'email', address: EMAIL, classes: ['p1_global_remote'], minScore: 10 })
      expect(ch.status === 201, `alert channel ${ch.status}`)
      await api('DELETE', `/api/alert-channels/${ch.json.id}`)
      const exp = await api<{ resumes: unknown[]; files: Record<string, string> }>('GET', '/api/me/export')
      expect(exp.status === 200 && Array.isArray(exp.json.resumes), 'export failed')
      return `${sessions.json.data.length} session(s) · channel created+removed · export ${Object.keys(exp.json.files).length} file link(s)`
    })

    await step('v4: task stream (SSE) delivers a terminal event', async () => {
      const r = await api<{ taskId: string }>('POST', `/api/jobs/${jobId}/analysis`, { resumeVersionId: versionId })
      expect(r.status === 202, `analysis ${r.status}`)
      const res = await fetch(`${BASE}/api/tasks/${r.json.taskId}/stream`, { headers: { cookie } })
      expect(res.headers.get('content-type')?.includes('text/event-stream') === true, 'not an event stream')
      const text = await res.text()
      expect(/event: (done|failed)/.test(text), 'no terminal event')
      return `${(text.match(/^event: /gm) ?? []).length} events`
    })

    await step('v5: preferences are seeded, editable, previewed and drive the inbox', async () => {
      const p = await api<{ doc: { home: { country: string; metros: string[] }; tiers: Array<{ id: string; label: string }> }; version: number; source: string }>('GET', '/api/preferences')
      expect(p.status === 200 && p.json.doc.home.country.length === 2, `preferences ${p.status}`)
      const doc = structuredClone(p.json.doc) as typeof p.json.doc & Record<string, unknown>
      doc.tiers[0].label = 'E2E tier'
      const pv = await api<{ sample: number; counts: Record<string, number> }>('POST', '/api/preferences/preview', { doc })
      expect(pv.status === 200 && typeof pv.json.sample === 'number', 'preview failed')
      const saved = await api<{ version: number; taskId: string }>('PUT', '/api/preferences', { doc, note: 'e2e' })
      expect(saved.status === 202 && saved.json.version === p.json.version + 1, `save ${saved.status}`)
      const t = await waitTask(saved.json.taskId)
      expect(t.status === 'done', `re-evaluation ${t.status}: ${t.error}`)
      const feed = await api<{ engine?: string; tiers?: Array<{ label: string }>; data: Array<{ id: string; eval?: { tier: string } }> }>('GET', '/api/jobs?tab=browse&limit=5')
      expect(feed.json.engine === 'evals', `feed engine ${feed.json.engine}`)
      expect((feed.json.tiers ?? []).some((x) => x.label === 'E2E tier'), 'tier label not reflected')
      const hist = await api<{ data: Array<{ version: number }> }>('GET', '/api/preferences/history')
      expect(hist.json.data[0].version === saved.json.version, 'history missing')
      return `v${p.json.version} (${p.json.source}) → v${saved.json.version} · preview ${pv.json.sample} jobs · feed engine ${feed.json.engine}`
    })

    await step('v7: visual editor save → tailored version rendered and re-scored', async () => {
      const v = await api<{ content: Record<string, unknown> }>('GET', `/api/resume-versions/${versionId}`)
      const draft = structuredClone(v.json.content) as { basics: { label?: string } }
      draft.basics.label = 'E2E Editor Headline'
      const r = await api<{ versionId: string; taskId: string; kind: string; changes: number; grounding: unknown[] }>('POST', '/api/resume-versions', { baseVersionId: versionId, jobId, content: draft, note: 'editor e2e' })
      expect(r.status === 202 && r.json.kind === 'tailored' && r.json.changes === 1, `editor save ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
      const t = await waitTask(r.json.taskId)
      expect(t.status === 'done', `render ${t.status}: ${t.error}`)
      const out = await api<{ renderStatus: string; changeLog: { editor?: boolean; scoreAfter?: number } }>('GET', `/api/resume-versions/${r.json.versionId}`)
      expect(out.json.renderStatus === 'rendered' && out.json.changeLog.editor === true, 'editor version not rendered')
      return `version ${r.json.versionId.slice(0, 8)} · ${r.json.changes} change · score after ${out.json.changeLog.scoreAfter ?? 'n/a'}`
    })

    await step('v4: metrics endpoint (admin) exposes Prometheus text', async () => {
      const res = await fetch(`${BASE}/api/metrics`, { headers: { cookie } })
      expect(res.status === 200, `metrics ${res.status}`)
      const body = await res.text()
      expect(body.includes('jobradar_log_events_total') || body.includes('process_resident_memory_bytes'), 'no metrics')
      return `${body.split('\n').filter((l) => l && !l.startsWith('#')).length} samples`
    })

    await step('health (admin) reports mode and AI availability', async () => {
      const r = await api<{ v3: { ollama?: { reachable: boolean }; queues: Record<string, unknown> } | null; counts: Record<string, number> }>('GET', '/api/health')
      expect(r.status === 200, `health ${r.status}`)
      return `ollama reachable=${r.json.v3?.ollama?.reachable ?? 'n/a'} · queues ${Object.keys(r.json.v3?.queues ?? {}).length}`
    })
  } finally {
    await step('cleanup (delete resume → versions/reports/files cascade; delete job)', async () => {
      let files = 0
      if (resumeId) { const r = await api<{ deleted: boolean }>('DELETE', `/api/resumes/${resumeId}`); files = r.json.deleted ? 1 : 0 }
      if (jobId) await prisma.job.delete({ where: { id: jobId } }).catch(() => undefined)
      const versions = tailoredId ? await prisma.resumeVersion.count({ where: { id: tailoredId } }) : 0
      expect(versions === 0, 'tailored version survived resume deletion')
      // audit NEW-01: vectors (and their chunk text) must go with the versions — only observable with an embedding provider
      const vectors = await prisma.embedding.count({ where: { ownerType: 'resume_version', ownerId: { in: [versionId, tailoredId].filter(Boolean) } } })
      expect(vectors === 0, `${vectors} resume vectors survived deletion`)
      return `resume deleted=${files}, job deleted, cascade + vector erasure verified`
    }).catch(() => undefined)
    await prisma.$disconnect()
    report()
  }
}

function report() {
  const ok = steps.filter((s) => s.ok).length
  const total = steps.length
  const failed = steps.filter((s) => !s.ok)
  mkdirSync('reports', { recursive: true })
  const md = [
    '# E2E — apply from the portal',
    '',
    `Generated ${new Date().toISOString()} · target ${BASE} · LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'default'} · EMBEDDING_PROVIDER=${process.env.EMBEDDING_PROVIDER ?? 'default'} · QUEUE_MODE=${process.env.QUEUE_MODE ?? 'bullmq'}`,
    '',
    `**Result: ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${ok}/${total} steps**`,
    '',
    '| # | Step | Result | ms | Detail |',
    '|---|---|---|---|---|',
    ...steps.map((s) => `| ${s.n} | ${s.name} | ${s.ok ? '✓' : '✗'} | ${s.ms} | ${s.detail.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n')
  writeFileSync('reports/e2e-apply-flow.md', md)
  writeFileSync('reports/e2e-apply-flow.json', JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, pass: failed.length === 0, steps }, null, 2))
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${ok}/${total} steps → reports/e2e-apply-flow.md`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
