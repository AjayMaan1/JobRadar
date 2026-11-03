/**
 * Browser E2E for the autofill extension (docs/HLD-browser-extension.md §5).
 *
 *  - serves four ATS fixture forms + a mock JobRadar `/api/ext/*` (bearer-checked, CORS for the extension origin)
 *  - loads the REAL unpacked extension (apps/extension) into headless Chromium via Playwright
 *  - pairs it (chrome.storage), opens each fixture, drives the service worker exactly like the popup does
 *  - asserts every filled value, the attached file, the skipped list, that no submit fired, and "mark applied"
 *
 *    node tools/extension-e2e/run.mjs            (after tools/sandbox-e2e/setup.sh, which links playwright)
 *    MOCK_BASE=http://localhost:3000 TOKEN=…      → run the same checks against a real JobRadar instance
 */
import http from 'node:http'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const EXT_DIR = resolve(ROOT, 'apps/extension')
const PORT = parseInt(process.env.EXT_E2E_PORT ?? '18090', 10)
const BASE = process.env.MOCK_BASE ?? `http://127.0.0.1:${PORT}`
const TOKEN = process.env.TOKEN ?? 'sandbox-extension-token'
const PDF = Buffer.from('%PDF-1.4\n% sandbox resume\n')
const steps = []
const expect = (cond, msg) => { if (!cond) throw new Error(`assertion failed: ${msg}`) }

const KIT = {
  job: { id: 'job-1', title: 'Senior Backend Engineer', company: 'Acme', applyUrl: `${BASE}/greenhouse.html`, ats: 'greenhouse', matchedBy: 'url' },
  ats: 'greenhouse',
  profile: { firstName: 'Asha', lastName: 'Verma', fullName: 'Asha Verma', email: 'asha@example.com', phone: '+91 98765 43210', location: 'Gurugram, IN', city: 'Gurugram', country: 'IN', linkedin: 'https://linkedin.com/in/asha', github: 'https://github.com/asha', portfolio: 'https://asha.dev', currentCompany: 'Acme Prev', currentTitle: 'Staff Engineer', headline: 'Senior Backend Engineer · Go, Kafka', about: 'I build payment systems.', applyDefaults: { noticePeriod: '30 days', workAuthorization: 'Yes', salaryExpectation: '45 LPA' } },
  resume: { versionId: 'v-tailored', kind: 'tailored', label: 'Tailored for Senior Backend Engineer', pdf: { url: `${BASE}/api/files/resume.pdf`, filename: 'Asha_Verma.pdf' }, docx: null, original: null },
  answers: [{ question: 'Why do you want to work at Acme?', answer: 'Because payments at scale is the problem I want to solve.', flagged: false }, { question: 'Describe a production incident you handled', answer: 'We lost a Kafka broker…', flagged: false }],
  coverNote: 'Hiring team at Acme,\n\nI am applying for the Senior Backend Engineer role.',
  application: null,
}
const applied = []

// ── mock server ───────────────────────────────────────────────────────────────────────────────────────────
function cors(req, res) {
  const o = req.headers.origin
  if (o && /^chrome-extension:\/\//.test(o)) { res.setHeader('access-control-allow-origin', o); res.setHeader('access-control-allow-headers', 'authorization, content-type'); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS') }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE)
  cors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (url.pathname.endsWith('.html')) { res.setHeader('content-type', 'text/html'); return res.end(readFileSync(resolve(here, 'fixtures', url.pathname.slice(1)))) }
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'bad token', code: 'unauthorized' })) }
    if (url.pathname === '/api/ext/me') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ user: { id: 'u1', email: 'asha@example.com' }, app: { name: 'JobRadar', version: 'mock' } })) }
    if (url.pathname === '/api/ext/apply-kit') {
      const page = url.searchParams.get('url') ?? ''
      const kit = page.includes('greenhouse.html') ? KIT : { ...KIT, job: null, ats: page.includes('lever') ? 'lever' : page.includes('ashby') ? 'ashby' : page.includes('workable') ? 'workable' : 'generic', answers: KIT.answers, application: null }
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(kit))
    }
    if (url.pathname === '/api/files/resume.pdf') { res.setHeader('content-type', 'application/pdf'); return res.end(PDF) }
    if (url.pathname === '/api/ext/applied') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { applied.push(JSON.parse(b)); res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ application: { id: 'app-1', status: 'applied' } })) }); return }
  }
  res.writeHead(404); res.end()
})

async function step(name, fn) {
  const t0 = Date.now()
  try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' }); console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`) }
  catch (e) { steps.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }); console.log(`✗ ${name} — ${e.message}`) }
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const profileDir = resolve('/tmp', `jr-ext-profile-${process.pid}`)
  const ctx = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`] })
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  const extId = new URL(sw.url()).host
  const call = (msg) => sw.evaluate((m) => globalThis.__jobradarHandle(m), msg)
  const tabIdFor = async (page) => { const tabs = await sw.evaluate(() => chrome.tabs.query({})); const t = tabs.find((x) => x.url === page.url()); return t.id }
  const values = (page, sel) => page.$$eval(sel, (els) => els.map((e) => [e.name || e.id, e.value]))

  try {
    await step('extension loads; service worker + content scripts registered', async () => `id ${extId}`)

    await step('unpaired → clear error from the API layer', async () => {
      const page = await ctx.newPage(); await page.goto(`${BASE}/greenhouse.html`)
      const r = await call({ type: 'kit', tabId: await tabIdFor(page) })
      expect(!r.ok && r.code === 'unpaired', `expected unpaired, got ${JSON.stringify(r)}`)
      await page.close()
      return r.error
    })

    await step('pair (options page storage) → /api/ext/me succeeds', async () => {
      await sw.evaluate(({ baseUrl, token }) => chrome.storage.local.set({ baseUrl, token }), { baseUrl: BASE, token: TOKEN })
      const r = await call({ type: 'me' })
      expect(r.ok && r.data.user.email === 'asha@example.com', JSON.stringify(r))
      return `connected as ${r.data.user.email}`
    })

    await step('greenhouse: job matched, badge ✓, inventory lists the fields', async () => {
      const page = await ctx.newPage(); await page.goto(`${BASE}/greenhouse.html`); await page.waitForTimeout(300)
      const tabId = await tabIdFor(page)
      const kit = await call({ type: 'kit', tabId })
      expect(kit.ok && kit.data.job && kit.data.job.matchedBy === 'url', 'kit/job')
      const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)
      expect(badge === '✓', `badge ${badge}`)
      const inv = await call({ type: 'inventory', tabId })
      expect(inv.ok && inv.data.ats === 'greenhouse' && inv.data.fields.includes('firstName') && inv.data.fields.includes('resume'), JSON.stringify(inv))
      page.__tabId = tabId; ctx.__gh = page
      return `fields: ${inv.data.fields.join(', ')}`
    })

    await step('greenhouse: fill → name/email/phone/location/cover letter/LinkedIn/answers/notice/auth, PDF attached, nothing submitted', async () => {
      const page = ctx.__gh
      const r = await call({ type: 'fill', tabId: page.__tabId })
      expect(r.ok, JSON.stringify(r))
      const rep = r.data
      const v = Object.fromEntries(await values(page, 'input, textarea, select'))
      expect(v['job_application[first_name]'] === 'Asha' && v['job_application[last_name]'] === 'Verma', 'names')
      expect(v['job_application[email]'] === 'asha@example.com' && v['job_application[phone]'] === '+91 98765 43210', 'contact')
      expect(v['job_application[location]'] === 'Gurugram, IN', 'location')
      expect(v['job_application[cover_letter_text]'].startsWith('Hiring team at Acme'), 'cover letter')
      expect(v['job_application[answers_attributes][0][text_value]'] === 'https://linkedin.com/in/asha', 'linkedin custom question')
      expect(v['job_application[answers_attributes][1][text_value]'].startsWith('Because payments'), 'answer matched by question text')
      expect(v['job_application[answers_attributes][2][text_value]'] === '30 days', 'notice period default')
      expect(v['job_application[answers_attributes][3][boolean_value]'] === '1', 'work authorisation select → Yes')
      const file = await page.$eval('#resume', (e) => (e.files[0] ? { name: e.files[0].name, size: e.files[0].size, type: e.files[0].type } : null))
      expect(file && file.name === 'Asha_Verma.pdf' && file.size === PDF.length, `attached ${JSON.stringify(file)}`)
      expect(rep.attached === 'Asha_Verma.pdf', 'report.attached')
      expect(rep.skipped.some((s) => s.key === 'answer' && /incident/.test(s.question)), 'unmatched answer reported for copy')
      expect(await page.evaluate(() => window.__submits) === 0, 'no submit')
      expect(await page.$eval('[data-jobradar-toast]', (e) => e.textContent.includes('Review, then click Submit')), 'toast')
      const highlighted = await page.$$eval('[data-jobradar-filled]', (els) => els.length)
      return `${rep.filled.length} filled, ${rep.skipped.length} skipped, ${highlighted} highlighted`
    })

    await step('greenhouse: second fill with "only empty" leaves edited values alone', async () => {
      const page = ctx.__gh
      await page.fill('#first_name', 'Edited')
      const r = await call({ type: 'fill', tabId: page.__tabId, onlyEmpty: true, attach: false })
      expect(r.ok && (await page.inputValue('#first_name')) === 'Edited', 'value overwritten')
      expect(r.data.skipped.some((s) => s.key === 'firstName' && s.reason === 'already filled'), 'reported as already filled')
      return 'kept user edit'
    })

    await step('greenhouse: "I submitted" → POST /api/ext/applied with the artifacts used', async () => {
      const page = ctx.__gh
      const r = await call({ type: 'applied', tabId: page.__tabId, followUpInDays: 7 })
      expect(r.ok, JSON.stringify(r))
      expect(applied.length === 1 && applied[0].jobId === 'job-1' && applied[0].resumeVersionId === 'v-tailored' && applied[0].followUpInDays === 7 && applied[0].answers.length === 2, JSON.stringify(applied))
      await page.close()
      return 'recorded job-1 with v-tailored'
    })

    for (const [fixture, checks] of [
      ['lever', async (page) => {
        const v = Object.fromEntries(await values(page, 'input, textarea'))
        expect(v.name === 'Asha Verma', 'single full-name field')
        expect(v.email === 'asha@example.com' && v.phone === '+91 98765 43210' && v.org === 'Acme Prev', 'contact/org')
        expect(v['urls[LinkedIn]'] === 'https://linkedin.com/in/asha' && v['urls[GitHub]'] === 'https://github.com/asha' && v['urls[Portfolio]'] === 'https://asha.dev', 'urls')
        expect(v.comments.startsWith('Hiring team'), 'additional information ← cover note')
        expect(v['cards[abc][field0]'].startsWith('Because payments'), 'custom card answer')
      }],
      ['ashby', async (page) => {
        const v = Object.fromEntries(await values(page, 'input, textarea'))
        expect(v._systemfield_name === 'Asha Verma' && v._systemfield_email === 'asha@example.com' && v._systemfield_phone === '+91 98765 43210', 'system fields')
        expect(v.f1 === 'https://linkedin.com/in/asha', 'linkedin by label')
        expect(v.f2 === '45 LPA', 'salary expectation by label')
        expect(v.f3.startsWith('Because payments'), 'answer by label')
      }],
      ['workable', async (page) => {
        const v = Object.fromEntries(await values(page, 'input, textarea'))
        expect(v.firstname === 'Asha' && v.lastname === 'Verma' && v.email === 'asha@example.com' && v.phone === '+91 98765 43210', 'names/contact')
        expect(v.address === 'Gurugram, IN', 'address ← location')
        expect(v.cover_letter.startsWith('Hiring team'), 'cover letter')
      }],
    ]) {
      await step(`${fixture}: profile-only fill (no matched job) + PDF attached + no submit`, async () => {
        const page = await ctx.newPage(); await page.goto(`${BASE}/${fixture}.html`); await page.waitForTimeout(300)
        const tabId = await tabIdFor(page)
        const kit = await call({ type: 'kit', tabId })
        expect(kit.ok && kit.data.job === null, 'profile-only kit')
        const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)
        expect(badge === '○', `badge ${badge}`)
        const r = await call({ type: 'fill', tabId })
        expect(r.ok, JSON.stringify(r))
        await checks(page)
        const file = await page.$eval('input[type=file]', (e) => (e.files[0] ? e.files[0].name : null))
        expect(file === 'Asha_Verma.pdf', `attached ${file}`)
        expect(await page.evaluate(() => window.__submits) === 0, 'no submit')
        await page.close()
        return `${r.data.filled.length} filled (${r.data.ats})`
      })
    }

    await step('revoked token → 401 surfaces as a pairing error, nothing filled', async () => {
      await sw.evaluate(() => chrome.storage.local.set({ token: 'revoked' }))
      const page = await ctx.newPage(); await page.goto(`${BASE}/lever.html`)
      const r = await call({ type: 'fill', tabId: await tabIdFor(page) })
      expect(!r.ok && r.status === 401, JSON.stringify(r))
      expect((await page.inputValue('input[name=name]')) === '', 'nothing filled')
      await page.close()
      return r.error
    })
  } finally {
    await ctx.close().catch(() => undefined)
    server.close()
    rmSync(profileDir, { recursive: true, force: true })
  }

  const ok = steps.filter((s) => s.ok).length
  const md = [`# extension-e2e`, '', `Generated ${new Date().toISOString()} · headless Chromium + real unpacked extension · base ${BASE}`, '', `**${ok === steps.length ? 'PASS' : 'FAIL'} — ${ok}/${steps.length} steps**`, '', '| # | Step | Result | ms | Detail |', '|---|---|---|---|---|', ...steps.map((s, i) => `| ${i + 1} | ${s.name} | ${s.ok ? '✓' : '✗'} | ${s.ms} | ${String(s.detail).replace(/\|/g, '\\|')} |`), ''].join('\n')
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true })
  writeFileSync(resolve(ROOT, 'reports/extension-e2e.md'), md)
  console.log(`\nextension-e2e: ${ok}/${steps.length} → reports/extension-e2e.md`)
  process.exit(ok === steps.length ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
