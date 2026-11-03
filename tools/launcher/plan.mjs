/**
 * Pure planner: facts (detect.mjs) + flags → { mode, steps, warnings, refusal, envUpdates }.
 * No I/O here so the decision table is unit-tested (launcher.test.ts).
 */
import { aiEnv, provision } from './env.mjs'

export const MODES = ['auto', 'native', 'docker', 'lite']

export function plan(facts, flags = {}) {
  const warnings = []
  const envUpdates = {}   // persisted to .env
  const runtimeEnv = {}   // this run only (fallbacks), passed to the child processes
  const steps = []
  const add = (id, title, why, data = {}) => steps.push({ id, title, why, ...data })

  // ── .env provisioning ──────────────────────────────────────────────────────────────────────────
  const { updates, generated } = provision(facts.env, { ...(flags.admin ? { ADMIN_EMAIL: flags.admin } : {}) })
  Object.assign(envUpdates, updates)
  const env = { ...facts.env, ...envUpdates }
  let ai = null
  if (flags.ai) {
    ai = aiEnv(flags.ai, Object.fromEntries(Object.entries(flags.keys ?? {}).filter(([, v]) => v)))
    for (const [k, v] of Object.entries(ai)) if (v !== '' || !env[k]) envUpdates[k] = v
    Object.assign(env, ai)
  }
  const llmIds = String(env.LLM_PROVIDER ?? 'cerebras,gemini,groq,none').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  let wantsOllama = llmIds.includes('ollama') || (env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama'
  for (const id of llmIds) {
    const keyEnv = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY', mistral: 'MISTRAL_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }[id]
    if (keyEnv && !env[keyEnv]) warnings.push(`LLM provider "${id}" is configured but ${keyEnv} is empty — it will be skipped by the chain until you add the key (./jobradar ai setup)`)
  }

  // ── mode ──────────────────────────────────────────────────────────────────────────────────────
  let mode = flags.mode ?? 'auto'
  const dockerOk = Boolean(facts.docker && facts.dockerDaemon)
  const canRunApp = Boolean(facts.pnpm)
  if (mode === 'auto') {
    if (facts.pg.up && canRunApp) mode = 'native'
    else if (dockerOk && canRunApp) mode = 'native'          // dev shape: compose for data services, pnpm for the app
    else if (dockerOk) mode = 'docker'
    else if (facts.pg.up && !canRunApp) return refuse(`Postgres is reachable but pnpm is not installed. Install pnpm (corepack enable && corepack prepare pnpm@9.14.2 --activate) or Docker.`)
    else return refuse('Nothing to run on: no Postgres reachable at DATABASE_URL and no Docker daemon.\n  Either: install Docker (https://docs.docker.com/get-docker/) and re-run, or point DATABASE_URL at a Postgres 16 and install pnpm.')
  }
  if (mode === 'docker' && !dockerOk) return refuse(facts.docker ? 'Docker Compose is installed but the daemon is not running (start Docker Desktop / `sudo systemctl start docker`).' : 'Docker Compose is not installed; use --mode native with a local Postgres instead.')
  if ((mode === 'native' || mode === 'lite') && !canRunApp) return refuse('pnpm is required for --mode native/lite (corepack enable && corepack prepare pnpm@9.14.2 --activate).')
  if ((mode === 'native' || mode === 'lite') && !facts.pg.up && !dockerOk) return refuse(`Postgres is not reachable at ${facts.pg.host}:${facts.pg.port} and Docker is unavailable to start one. Start Postgres or fix DATABASE_URL.`)

  // ── docker mode: compose does everything ───────────────────────────────────────────────────
  if (mode === 'docker') {
    if (Object.keys(envUpdates).length || !facts.envFile) add('env', 'Write .env', facts.envFile ? `fill ${Object.keys(envUpdates).join(', ')}` : 'create from .env.example with generated secrets')
    const profiles = wantsOllama ? ['ai'] : []
    add('compose-up', 'docker compose up -d --build', `postgres, redis, web, worker, backup${wantsOllama ? ', ollama (profile ai)' : ''}`, { profiles })
    if (wantsOllama) add('ollama-pull', `ollama pull ${[facts.ollama.llmModel, facts.ollama.embedModel].join(', ')}`, 'through the published port, with progress (ollama-init does the same inside compose)', { models: [...(llmIds.includes('ollama') ? [facts.ollama.llmModel] : []), ...((env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama' ? [facts.ollama.embedModel] : [])], base: 'http://127.0.0.1:11434', wait: true })
    add('verify', 'Wait for http://localhost:3000/login and the worker /healthz', 'health probes through the published ports', { web: 'http://127.0.0.1:3000', worker: 'http://127.0.0.1:9464' })
    return { mode, steps, warnings, envUpdates, runtimeEnv, generated, refusal: null, supervise: false }
  }

  // ── native / lite ──────────────────────────────────────────────────────────────────────────
  const lite = mode === 'lite'
  const infra = []
  if (!facts.pg.up) infra.push('postgres')
  let queueMode = lite ? 'inline' : (env.QUEUE_MODE ?? 'bullmq')
  if (!lite && queueMode !== 'inline' && !facts.redis.up) {
    if (dockerOk) infra.push('redis')
    else { queueMode = 'inline'; warnings.push('Redis is not reachable and Docker is unavailable → running with QUEUE_MODE=inline (no crawler scheduler; user tasks run inside the web process). Start Redis to get the full worker.') }
  }
  if (queueMode !== (facts.env.QUEUE_MODE ?? 'bullmq')) runtimeEnv.QUEUE_MODE = queueMode
  if (Object.keys(envUpdates).length || !facts.envFile) add('env', 'Write .env', facts.envFile ? `fill ${Object.keys(envUpdates).join(', ')}` : 'create from .env.example with generated secrets')
  if (infra.length) {
    add('compose-up', `docker compose up -d ${infra.join(' ')}`, `${infra.join(' and ')} not reachable locally — start in Docker`, { services: infra })
    add('wait-infra', 'Wait for Postgres/Redis ports', 'TCP readiness before migrating', { services: infra })
  }
  if (!facts.deps.nodeModules || facts.deps.stale) { if (flags.skipInstall) warnings.push('node_modules missing/stale but --skip-install given'); else add('pnpm-install', 'pnpm install --frozen-lockfile', facts.deps.nodeModules ? 'lockfile is newer than node_modules' : 'node_modules missing') }
  if (!facts.deps.prismaGenerated || !facts.deps.nodeModules) add('prisma-generate', 'pnpm db:generate', 'Prisma client not generated')
  add('migrate', 'prisma migrate deploy', 'apply pending migrations (no-op when current)')
  add('seed', 'pnpm db:seed', 'host policies, anchor companies, sources (idempotent upserts)')

  // AI
  if (wantsOllama) {
    if (!facts.ollama.up) {
      if (facts.ollamaBin) add('ollama-start', 'Start `ollama serve` (managed)', 'binary present, nothing listening', { base: facts.ollama.base })
      else {
        const without = llmIds.filter((x) => x !== 'ollama')
        const fallback = without.length ? without.join(',') : 'none'
        warnings.push(`Ollama is not installed (https://ollama.com/download). Continuing with LLM_PROVIDER=${fallback}${(env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama' ? ' and EMBEDDING_PROVIDER=none' : ''} for this run — deterministic features keep working. Re-run after installing, or choose a hosted tier: ./jobradar ai setup`)
        runtimeEnv.LLM_PROVIDER = fallback
        if ((env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama') runtimeEnv.EMBEDDING_PROVIDER = 'none'
        wantsOllama = false
      }
    }
    if (wantsOllama) {
      const models = []
      if (llmIds.includes('ollama') && !facts.ollama.hasLlmModel) models.push(facts.ollama.llmModel)
      if ((env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama' && !facts.ollama.hasEmbedModel) models.push(facts.ollama.embedModel)
      if (models.length) add('ollama-pull', `ollama pull ${models.join(', ')}`, 'models not present locally (≈2.3 GB first time)', { models, base: facts.ollama.base })
    }
  }
  if (!facts.deps.chromium && !lite) {
    if (flags.skipChromium) warnings.push('Chromium missing — tailored PDFs use the simple renderer')
    else add('chromium', 'npx playwright install chromium', 'PDF rendering (≈150 MB); skip with --skip-chromium → simple renderer')
  }
  if (flags.prod) {
    if (!facts.deps.nextBuild || facts.deps.nextBuildStale) add('build', 'pnpm --filter @jobradar/web build', facts.deps.nextBuild ? 'sources changed since the last build' : 'no production build yet')
  }
  const webPort = facts.ports.web ? 3000 : (flags.prod ? null : 3001)
  if (webPort === null) return refuse('Port 3000 is busy and --prod refuses to move ports. Stop the other process or set PORT.')
  if (webPort !== 3000) { warnings.push(`Port 3000 is busy → web on ${webPort}`); runtimeEnv.APP_URL = `http://localhost:${webPort}` }
  add('app', lite || queueMode === 'inline' ? 'Start web (QUEUE_MODE=inline)' : 'Start web + worker', (lite || queueMode === 'inline') ? (flags.prod ? 'production: next start (worker handlers run inline)' : 'development: next dev (worker handlers run inline)') : (flags.prod ? 'production: next start + tsx worker' : 'development: next dev + tsx watch worker'), { processes: lite || queueMode === 'inline' ? ['web'] : ['web', 'worker'], port: webPort, prod: Boolean(flags.prod), queueMode })
  add('verify', `Wait for http://localhost:${webPort}/login${lite || queueMode === 'inline' ? '' : ' and worker /healthz'}`, 'health probes', { web: `http://127.0.0.1:${webPort}`, worker: lite || queueMode === 'inline' ? null : 'http://127.0.0.1:9464' })
  return { mode, steps, warnings, envUpdates, runtimeEnv, generated, refusal: null, supervise: true, queueMode, webPort }
}

function refuse(message) { return { mode: null, steps: [], warnings: [], envUpdates: {}, runtimeEnv: {}, generated: [], refusal: message, supervise: false } }

export function formatPlan(p) {
  const lines = [`mode: ${p.mode}${p.queueMode ? ` · queue: ${p.queueMode}` : ''}`]
  p.steps.forEach((s, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${s.title}  — ${s.why}`))
  for (const w of p.warnings) lines.push(`  ! ${w}`)
  return lines.join('\n')
}
