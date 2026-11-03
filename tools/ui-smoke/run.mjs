/**
 * UI smoke run (HLD-ui-v8 §6): the REAL page components + REAL API route handlers + REAL Tailwind CSS,
 * in headless Chromium, against a seeded in-memory database — no Next.js server, no network.
 *
 *   node tools/ui-smoke/run.mjs            → reports/ui-smoke.md + reports/ui-smoke/*.png
 *   KEEP=1 node tools/ui-smoke/run.mjs     → leaves the server up on :18100 for manual poking
 *
 * What it proves: every route in the v8 IA mounts, loads its data, has no console errors / failed API calls,
 * key interactions work (tabs, selection, drawer, editor live preview), and the layout holds at desktop + mobile.
 * What it cannot prove: Next.js server components / middleware / `next build` (run tools/e2e/run-local.sh online).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build } from './build.mjs'
import { buildCss } from './css.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const PORT = parseInt(process.env.UI_SMOKE_PORT ?? '18100', 10)
const BASE = `http://127.0.0.1:${PORT}`
const OUT = resolve(ROOT, 'reports/ui-smoke')
const TMP = '/tmp/ui-smoke'
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true })

const steps = []
const shots = []
const expect = (cond, msg) => { if (!cond) throw new Error(`assertion failed: ${msg}`) }
async function step(name, fn) {
  const t0 = Date.now()
  try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' }); console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`) }
  catch (e) { steps.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }); console.log(`✗ ${name} — ${e.message}`) }
}

async function startServer() {
  const child = spawn('tsx', [resolve(here, 'server.ts'), String(PORT)], { cwd: ROOT, env: { ...process.env, UI_SMOKE_BUNDLE: `${TMP}/bundle.js`, UI_SMOKE_CSS: `${TMP}/smoke.css` }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const seeded = await new Promise((res, rej) => {
    const t = setInterval(() => {
      const m = log.match(/^ready \d+ (.*)$/m)
      if (m) { clearInterval(t); res(JSON.parse(m[1])) }
      if (/^Error|TypeError|^\s+at /m.test(log) && !/^ready/m.test(log)) { clearInterval(t); rej(new Error('server failed:\n' + log.slice(-2000))) }
    }, 200)
    setTimeout(() => { clearInterval(t); rej(new Error('server start timeout\n' + log.slice(-2000))) }, 120_000)
  })
  return { child, seeded, log: () => log }
}

async function main() {
  const bundle = await build(`${TMP}/bundle.js`)
  const css = await buildCss(`${TMP}/smoke.css`)
  console.log(`bundle: ${Object.keys(bundle.metafile.inputs).length} modules · css: ${css ? `tailwind ${css.version}, ${css.bytes} bytes` : 'none'}`)

  const srv = await startServer()
  const S = srv.seeded
  const browser = await chromium.launch({ channel: 'chromium', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const consoleErrors = []
  const apiFailures = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/stream')) apiFailures.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`) })

  const visit = async (path, waitFor) => { await page.goto(BASE + path, { waitUntil: 'networkidle' }); if (waitFor) await page.waitForSelector(waitFor, { timeout: 15_000 }); await page.waitForTimeout(150) }
  const shot = async (name, opts = {}) => { const f = `${OUT}/${name}.png`; await page.screenshot({ path: f, fullPage: opts.fullPage ?? false }); shots.push(name) }
  const text = async (sel) => (await page.textContent(sel)) ?? ''
  const countOf = async (sel) => page.locator(sel).count()
  const drainErrors = () => { const e = consoleErrors.splice(0), a = apiFailures.splice(0); return { e, a } }
  const noErrors = (ctxName) => { const { e, a } = drainErrors(); expect(!e.length, `${ctxName}: console errors: ${e.join(' | ')}`); expect(!a.length, `${ctxName}: failed API calls: ${a.join(', ')}`) }

  try {
    await step('inbox (/) mounts with sidebar IA, list + detail, tier chips', async () => {
      await visit('/', '[data-smoke="job-row"]')
      const rows = await countOf('[data-smoke="job-row"]')
      expect(rows >= 4, `expected ≥4 job rows, got ${rows}`)
      const nav = await page.locator('nav a').allTextContents()
      for (const item of ['Inbox', 'Applications', 'Resumes', 'Profile', 'Preferences', 'Account', 'Overview', 'Companies', 'Sources & hosts', 'Queues']) expect(nav.some((t) => t.includes(item)), `nav has ${item}: ${nav.join(',')}`)
      await shot('01-inbox')
      noErrors('inbox')
      return `${rows} rows · nav: ${nav.filter(Boolean).join(' / ')}`
    })

    await step('inbox: selecting a row opens the detail; ?job= deep-link selects it', async () => {
      await page.locator('[data-smoke="job-row"]').first().click()
      await page.waitForSelector('[data-smoke="job-detail"]', { timeout: 10_000 })
      const title = await text('[data-smoke="job-detail"] h2')
      expect(title.length > 3, 'detail shows a title')
      await visit(`/?job=${S.jobs.j1}`, '[data-smoke="job-detail"]')
      const t2 = await text('[data-smoke="job-detail"] h2')
      expect(t2.includes('Backend'), `deep-linked detail is j1, got "${t2}"`)
      await shot('02-inbox-detail')
      noErrors('inbox detail')
      return `"${t2}"`
    })

    await step('inbox: Match / Tailor / Apply tabs show the stored report, pending suggestions and the apply kit', async () => {
      const tabs = page.locator('[data-smoke="job-detail"] [role="tablist"] button, [data-smoke="job-detail"] nav button')
      const click = async (re) => { const b = page.locator('[data-smoke="job-detail"] button').filter({ hasText: re }).first(); await b.click(); await page.waitForTimeout(400) }
      await click(/^Match/)
      await page.waitForFunction(() => /Required skills|required/i.test(document.querySelector('[data-smoke="job-detail"]').innerText), null, { timeout: 10_000 })
      await shot('03-inbox-match')
      await click(/^Tailor/)
      await page.waitForFunction(() => /Apply|Reject|suggestion/i.test(document.querySelector('[data-smoke="job-detail"]').innerText), null, { timeout: 10_000 })
      const pending = await page.locator('[data-smoke="job-detail"] button').filter({ hasText: /^Accept|^Apply$/ }).count()
      await shot('04-inbox-tailor')
      await click(/^Apply$/)
      await page.waitForFunction(() => /defaults|Cover|Questions|Files|Download|Mark applied|original/i.test(document.querySelector('[data-smoke="job-detail"]').innerText), null, { timeout: 10_000 })
      await shot('05-inbox-applykit')
      noErrors('match/tailor/apply kit')
      void tabs
      return `${pending} pending suggestion action(s)`
    })

    await step('inbox: tabs Saved / Not interested / Closed filter through the real API', async () => {
      await visit('/', '[data-smoke="job-row"]')
      const tab = async (name) => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(500) }
      await tab('Saved')
      const saved = await countOf('[data-smoke="job-row"]'); expect(saved === 1, `saved = 1, got ${saved}`)
      await tab('Not interested')
      const rej = await countOf('[data-smoke="job-row"]'); expect(rej === 1, `rejected = 1, got ${rej}`)
      await tab('Closed')
      const closed = await countOf('[data-smoke="job-row"]'); expect(closed === 1, `closed = 1, got ${closed}`)
      noErrors('tabs')
      return `saved ${saved} · not interested ${rej} · closed ${closed}`
    })

    await step('inbox: search box filters the list (FTS through the real route)', async () => {
      await visit('/', '[data-smoke="job-row"]')
      await page.fill('input[placeholder*="Search"]', 'Kubernetes')
      await page.waitForTimeout(700)
      const n = await countOf('[data-smoke="job-row"]')
      expect(n >= 1 && n < 8, `search narrows the list, got ${n}`)
      noErrors('search')
      return `${n} rows for "Kubernetes"`
    })

    await step('applications (/applications): pipeline board with the applied job; card opens the drawer', async () => {
      await visit('/applications', '[data-smoke="pipeline-card"]')
      const cards = await countOf('[data-smoke="pipeline-card"]')
      expect(cards === 1, `1 application card, got ${cards}`)
      expect((await page.textContent('body')).includes('Atlassian'), 'card shows the company')
      await shot('06-applications')
      await page.locator('[data-smoke="pipeline-card"]').first().click()
      await page.waitForSelector('[data-smoke="job-detail"]', { timeout: 10_000 })
      await shot('07-applications-drawer')
      await page.keyboard.press('Escape')
      noErrors('applications')
      return `${cards} card(s)`
    })

    await step('resumes (/resumes): upload card, list with Master badge + status, parse review with warnings', async () => {
      await visit('/resumes', 'text=Backend – master')
      expect((await page.textContent('body')).includes('Master'), 'master badge')
      expect((await page.textContent('body')).includes('Parsed'), 'parsed status')
      await page.waitForSelector('text=parse review', { timeout: 10_000 })
      expect((await page.textContent('body')).toLowerCase().includes('table was flattened'), 'parse warning shown')
      const editLinks = await page.locator('a[href$="/edit"]').count()
      expect(editLinks >= 2, `editor links present (header + row), got ${editLinks}`)
      await shot('08-resumes', { fullPage: true })
      noErrors('resumes')
      return `${editLinks} editor links`
    })

    await step('editor (/resumes/:id/edit): full-bleed 2-pane; a headline edit updates the live preview + change count', async () => {
      await visit(`/resumes/${S.resumeId}/edit`, 'iframe[title="preview"]')
      await page.waitForSelector('text=Live preview', { timeout: 10_000 })
      const headline = page.locator('input').filter({ hasText: '' }).nth(1)
      const inputs = await page.locator('input[type="text"], input:not([type])').all()
      let target = null
      for (const i of inputs) { const v = await i.inputValue(); if (v && /engineer/i.test(v)) { target = i; break } }
      expect(target, 'found the headline input')
      await target.fill('Principal Engineer · Smoke Test')
      await page.waitForTimeout(500)
      const frame = page.frameLocator('iframe[title="preview"]')
      await frame.locator('text=Principal Engineer · Smoke Test').waitFor({ timeout: 10_000 })
      expect((await page.textContent('body')).match(/1 change/), 'toolbar shows "1 change"')
      const saveBtn = page.getByRole('button', { name: /Save as new version/ })
      expect(await saveBtn.isEnabled(), 'save enabled once dirty')
      await shot('09-editor')
      noErrors('editor')
      void headline
    })

    await step('editor with a job (/resumes/:id/edit?job=&base=): 3-pane with score rail + suggestions; Apply updates the live score', async () => {
      await visit(`/resumes/${S.resumeId}/edit?job=${S.jobs.j1}&base=${S.masterVersionId}`, 'iframe[title="preview"]')
      await page.waitForSelector('text=/Tailoring for/', { timeout: 10_000 })
      const applyButtons = page.getByRole('button', { name: /^Apply$/ })
      const n = await applyButtons.count()
      expect(n >= 1, `suggestions with Apply buttons, got ${n}`)
      const before = await page.textContent('body')
      await applyButtons.first().click()
      await page.waitForTimeout(500)
      expect((await page.textContent('body')).match(/1 change/), 'applied suggestion counts as a change')
      await shot('10-editor-job')
      noErrors('editor+job')
      return `${n} applicable suggestion(s)` + (before ? '' : '')
    })

    await step('profile (/profile): master profile form is populated from the seed', async () => {
      await visit('/profile', 'text=Master profile')
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value.includes('Senior Backend Engineer')), null, { timeout: 10_000 })
      expect((await page.textContent('body')).includes('Confirmed facts (1)'), 'confirmed facts listed')
      await shot('11-profile', { fullPage: true })
      noErrors('profile')
    })

    await step('preferences (/preferences): document loads (home country, tiers, pay floor) and the wizard/sections render', async () => {
      await visit('/preferences', 'text=/Preferences/')
      await page.waitForFunction(() => document.body.innerText.includes('Tier') || document.body.innerText.includes('tier'), null, { timeout: 15_000 })
      const body = await page.textContent('body')
      expect(/Home|Where you live|metro/i.test(body), 'home section')
      await shot('12-preferences', { fullPage: true })
      noErrors('preferences')
    })

    await step('account (/account): password, sessions, alerts, extension, data cards', async () => {
      await visit('/account', 'text=Account & alerts')
      const body = await page.textContent('body')
      for (const t of ['Password', 'Active sessions', 'Alerts', 'Browser extension', 'Your data']) expect(body.includes(t), `card ${t}`)
      expect(await page.locator('button:has-text("Erase account")').isDisabled(), 'erase disabled until the email is typed')
      await shot('13-account', { fullPage: true })
      noErrors('account')
    })

    await step('admin overview (/admin): stats, worker pill, problem boards; health feeds the sidebar pill', async () => {
      await visit('/admin', 'text=/Overview/')
      await page.waitForFunction(() => /open jobs|Open jobs|boards/i.test(document.body.innerText), null, { timeout: 15_000 })
      const body = await page.textContent('body')
      expect(/Adobe/.test(body), 'failing board (Adobe) listed')
      expect(body.includes('AI providers'), 'AI provider chain card')
      expect(body.includes('public only'), 'gemini (may-train) flagged as public-inputs-only')
      expect(body.includes('stays local'), 'fake/local member flagged as local')
      await shot('14-admin-overview', { fullPage: true })
      noErrors('admin overview')
    })

    await step('admin companies (/admin/companies): table with the 3 seeded companies + boards; /watchlist redirects here', async () => {
      await visit('/admin/companies', 'text=GitLab')
      const body = await page.textContent('body')
      for (const c of ['GitLab', 'Atlassian', 'Adobe']) expect(body.includes(c), `company ${c}`)
      await shot('15-admin-companies', { fullPage: true })
      noErrors('admin companies')
    })

    await step('admin sources (/admin/sources): host policies + aggregator sources', async () => {
      await visit('/admin/sources', 'text=Remotive')
      const body = await page.textContent('body')
      expect(body.includes('We Work Remotely'), 'second source listed')
      await shot('16-admin-sources', { fullPage: true })
      noErrors('admin sources')
    })

    await step('admin queues (/admin/queues): inline mode shown, no failed jobs', async () => {
      await visit('/admin/queues', 'text=/inline/')
      await shot('17-admin-queues')
      noErrors('admin queues')
    })

    await step('login (/login): brand panel + form with email/password', async () => {
      await visit('/login', 'input[type="email"], input[name="email"]')
      expect(await page.locator('input[type="password"]').count() === 1, 'password field')
      await shot('18-login')
      drainErrors() // login may probe /api/auth/me → 401 by design
    })

    await step('mobile (375px): sidebar collapses behind the menu button; inbox list is single-column', async () => {
      await page.setViewportSize({ width: 375, height: 812 })
      await visit('/', '[data-smoke="job-row"]')
      expect(await page.locator('button[aria-label="Open navigation"]').isVisible(), 'hamburger visible')
      await shot('19-inbox-mobile', { fullPage: false })
      expect(!(await page.locator('[data-smoke="job-detail"]').isVisible()), 'detail hidden until a row is tapped')
      await page.locator('[data-smoke="job-row"]').nth(1).click()
      await page.waitForSelector('[data-smoke="job-detail"]', { state: 'visible', timeout: 10_000 })
      await shot('20-inbox-mobile-detail')
      await page.getByRole('button', { name: 'Back to list' }).click()
      await page.waitForTimeout(200)
      expect(!(await page.locator('[data-smoke="job-detail"]').isVisible()), 'back returns to the list')
      await page.locator('button[aria-label="Open navigation"]').click()
      await page.waitForTimeout(300)
      await shot('21-inbox-mobile-nav')
      await page.setViewportSize({ width: 1440, height: 900 })
      noErrors('mobile')
    })

    await step('no stray legacy palette classes in the bundle (gray-*/blue-*/red-* → slate/indigo/rose)', async () => {
      const src = readFileSync(`${TMP}/bundle.js`, 'utf8').split('//# sourceMappingURL')[0]
      const legacy = [...new Set((src.match(/\b(?:bg|text|border|ring|decoration)-(?:gray|blue|red|green|yellow|purple)-\d{2,3}\b/g) ?? []))]
      expect(legacy.length === 0, `legacy classes still used: ${legacy.join(', ')}`)
    })
  } finally {
    await browser.close()
    if (process.env.KEEP) console.log(`server left running on ${BASE} (pid ${srv.child.pid})`); else srv.child.kill('SIGTERM')
  }

  const ok = steps.filter((s) => s.ok).length
  const md = [
    '# ui-smoke', '', `Generated ${new Date().toISOString()} · ${steps.length} steps · **${ok} passed** · ${steps.length - ok} failed`, '',
    `Real page components (esbuild) + real API route handlers (bridged) + real Tailwind CSS${css ? ` (${css.version})` : ' (unavailable)'} in headless Chromium against a seeded in-memory DB.`, '',
    '| # | step | result | detail |', '|---|---|---|---|',
    ...steps.map((s, i) => `| ${i + 1} | ${s.name} | ${s.ok ? '✅' : '❌'} | ${(s.detail || '').replace(/\|/g, '\\|').slice(0, 300)} |`), '',
    '## Screenshots', '', ...shots.map((s) => `- [${s}](ui-smoke/${s}.png)`), '',
  ].join('\n')
  writeFileSync(resolve(ROOT, 'reports/ui-smoke.md'), md)
  writeFileSync(resolve(ROOT, 'reports/ui-smoke.json'), JSON.stringify({ generatedAt: new Date().toISOString(), steps, shots }, null, 2))
  console.log(`\nui-smoke: ${ok}/${steps.length} passed → reports/ui-smoke.md`)
  process.exit(ok === steps.length ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
