/** Step executors for plan.mjs. Each is idempotent and re-checks its own precondition. */
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { color, httpJson, httpRequest, log, run, tcpOpen, waitFor, parseUrl, which } from './util.mjs'
import { mergeEnv, readEnvFile, writeEnvFile } from './env.mjs'

export const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

export async function stepEnv(root, planned) {
  if (!existsSync(join(root, '.env'))) copyFileSync(join(root, '.env.example'), join(root, '.env'))
  const { text } = readEnvFile(root)
  if (Object.keys(planned.envUpdates).length) writeEnvFile(root, mergeEnv(text, planned.envUpdates))
  return true
}

export function composeArgs(step, { build = false } = {}) {
  const args = ['compose']
  for (const p of step.profiles ?? []) args.push('--profile', p)
  args.push('up', '-d')
  if (build) args.push('--build')
  if (step.services?.length) args.push(...step.services)
  return args
}

export async function stepComposeUp(root, step, opts = {}) {
  const code = await run('docker', composeArgs(step, opts), { cwd: root, prefix: 'docker' })
  return code === 0
}

export async function stepWaitInfra(facts, step) {
  const checks = []
  if (step.services.includes('postgres')) checks.push(['Postgres', () => tcpOpen(facts.pg.host, facts.pg.port)])
  if (step.services.includes('redis')) checks.push(['Redis', () => tcpOpen(facts.redis.host, facts.redis.port)])
  for (const [name, probe] of checks) {
    process.stdout.write(`  waiting for ${name} `)
    const ok = await waitFor(name, probe, { timeoutMs: 90_000 })
    console.log(ok ? color.green(' ready') : color.red(' timeout'))
    if (!ok) return false
  }
  // Postgres accepts TCP before it accepts connections during init; give it a moment
  if (step.services.includes('postgres')) await new Promise((r) => setTimeout(r, 2500))
  return true
}

export const stepPnpm = (root, args, prefix = 'pnpm') => run(PNPM, args, { cwd: root, prefix }).then((c) => c === 0)

export async function stepOllamaStart(root, step, supervisor) {
  // managed child: logs under .jobradar/logs/ollama.log, stopped on ./jobradar down
  supervisor.add({ name: 'ollama', cmd: 'ollama', args: ['serve'], env: { OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL ?? '1', OLLAMA_MAX_LOADED_MODELS: process.env.OLLAMA_MAX_LOADED_MODELS ?? '2', OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE ?? '30m' } })
  const entry = supervisor.children.get('ollama')
  supervisor.start(entry, supervisor.children.size - 1)
  const u = parseUrl(step.base, { host: '127.0.0.1', port: 11434 })
  process.stdout.write('  waiting for Ollama ')
  const ok = await waitFor('ollama', () => tcpOpen(u.host, u.port), { timeoutMs: 60_000 })
  console.log(ok ? color.green(' ready') : color.red(' timeout'))
  return ok
}

/** Pull through the HTTP API so progress is visible and no CLI is required (works against Docker too). */
export async function stepOllamaPull(step) {
  if (step.wait) {
    process.stdout.write('  waiting for Ollama ')
    const ok = await waitFor('ollama', async () => Boolean(await httpJson(`${step.base}/api/tags`, 2000)), { timeoutMs: 120_000 })
    console.log(ok ? color.green(' ready') : color.red(' timeout'))
    if (!ok) return false
  }
  for (const model of step.models) {
    const tags = await httpJson(`${step.base}/api/tags`, 3000)
    if ((tags?.models ?? []).some((m) => m.name === model || m.name === `${model}:latest`)) { log.ok(`${model} already present`); continue }
    process.stdout.write(`  pulling ${model} `)
    let lastPct = -1
    let failed = null
    const r = await httpRequest(`${step.base}/api/pull`, {
      method: 'POST', body: { model, stream: true },
      onLine: (line) => {
        line = line.trim()
        if (!line) return
        let j; try { j = JSON.parse(line) } catch { return }
        if (j.error) failed = j.error
        if (j.total && j.completed) { const pct = Math.floor((j.completed / j.total) * 100); if (pct !== lastPct && pct % 10 === 0) { process.stdout.write(`${pct}% `); lastPct = pct } }
      },
    })
    if (r.status < 200 || r.status >= 300) { console.log(color.red(` HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`)); return false }
    console.log(failed ? color.red(` failed: ${failed}`) : color.green(' done'))
    if (failed) return false
  }
  return true
}

export async function stepChromium(root) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  if (!which(npx.replace('.cmd', ''))) { log.warn('npx not found — skipping Chromium (simple PDF renderer)'); return true }
  const code = await run(npx, ['playwright', 'install', 'chromium'], { cwd: root, prefix: 'playwright' })
  if (code !== 0) log.warn('Chromium install failed — tailored PDFs will use the simple renderer')
  return true // never fatal
}

/** Child specs for the app processes (native/lite). */
export function appProcesses(root, step, env) {
  const procs = []
  const webEnv = { ...env, PORT: String(step.port), QUEUE_MODE: step.queueMode, APP_NAME: 'web', LOG_FORMAT: env.LOG_FORMAT ?? (step.prod ? 'json' : 'pretty') }
  procs.push(step.prod
    ? { name: 'web', cmd: PNPM, args: ['--filter', '@jobradar/web', 'exec', 'next', 'start', '-p', String(step.port)], cwd: root, env: webEnv, health: `http://127.0.0.1:${step.port}/login` }
    : { name: 'web', cmd: PNPM, args: ['--filter', '@jobradar/web', 'exec', 'next', 'dev', '-p', String(step.port)], cwd: root, env: webEnv, health: `http://127.0.0.1:${step.port}/login` })
  if (step.processes.includes('worker')) {
    const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
    procs.push({ name: 'worker', cmd: tsx, args: step.prod ? ['apps/worker/src/index.ts'] : ['watch', 'apps/worker/src/index.ts'], cwd: root, env: { ...env, QUEUE_MODE: 'bullmq', APP_NAME: 'worker', LOG_FORMAT: env.LOG_FORMAT ?? (step.prod ? 'json' : 'pretty') }, health: 'http://127.0.0.1:9464/healthz' })
  }
  return procs
}

export function readEnvForChildren(root) {
  // children read .env themselves (dotenv / next), but inline overrides (PORT, QUEUE_MODE) need the file values as a base
  return existsSync(join(root, '.env')) ? Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/\s+#.*$/, '').replace(/^"(.*)"$/, '$1')] })) : {}
}
