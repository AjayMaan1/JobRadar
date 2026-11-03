/**
 * Launcher decision table (docs/HLD-unified-launcher.md §3.2): .env handling, planner fixtures, compose args,
 * supervisor backoff and state file. Pure modules — no processes are spawned here.
 *   tsx tools/testkit/run-tests.ts launcher tools/launcher/launcher.test.ts
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore — plain ESM launcher modules
import { parseEnv, mergeEnv, provision, aiEnv, genPassword } from './env.mjs'
// @ts-ignore
import { plan } from './plan.mjs'
// @ts-ignore
import { composeArgs, appProcesses } from './steps.mjs'
// @ts-ignore
import { backoff, readState, writeState, clearState } from './supervisor.mjs'

const EXAMPLE = `# Database
DATABASE_URL=postgresql://jobradar:jobradar@localhost:5432/jobradar
REDIS_URL=redis://localhost:6379
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=
STORAGE_SIGNING_SECRET=
LLM_MODEL=qwen2.5:3b-instruct       # ollama model
QUEUE_MODE=bullmq
`

/** A complete facts object; override per fixture. */
function facts(over: Record<string, any> = {}) {
  const base = {
    root: '/repo', node: '22.0.0', pnpm: '9.14.2', docker: '2.29', dockerDaemon: true, ollamaBin: true, psqlBin: false, cpus: 4, memGb: 16, platform: 'linux',
    envFile: true, missingEnv: [] as string[],
    env: { DATABASE_URL: 'postgresql://jobradar:jobradar@localhost:5432/jobradar', REDIS_URL: 'redis://localhost:6379', STORAGE_SIGNING_SECRET: 's', ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD: 'p', APP_URL: 'http://localhost:3000', CONTACT_EMAIL: 'a@b.c', LLM_PROVIDER: 'ollama', EMBEDDING_PROVIDER: 'ollama', QUEUE_MODE: 'bullmq' } as Record<string, string>,
    pg: { host: 'localhost', port: 5432, up: true }, redis: { host: 'localhost', port: 6379, up: true },
    ollama: { base: 'http://127.0.0.1:11434', up: true, models: ['qwen2.5:3b-instruct', 'nomic-embed-text:latest'], wanted: true, llmModel: 'qwen2.5:3b-instruct', embedModel: 'nomic-embed-text', hasLlmModel: true, hasEmbedModel: true },
    llm: { ids: ['ollama'], keys: {}, embedding: 'ollama' },
    deps: { nodeModules: true, stale: false, prismaGenerated: true, nextBuild: false, nextBuildStale: false, chromium: true },
    ports: { web: true, worker: true }, queueMode: 'bullmq',
  }
  const merged: any = { ...base }
  for (const [k, v] of Object.entries(over)) merged[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(base as any)[k], ...v } : v
  return merged
}
const ids = (p: any) => p.steps.map((s: any) => s.id)

describe('.env parsing and merging', () => {
  it('parses values, strips inline comments, honours quotes', () => {
    const v = parseEnv(`${EXAMPLE}QUOTED="a # not a comment"\nexport X=1\n`)
    expect(v.LLM_MODEL).toBe('qwen2.5:3b-instruct')
    expect(v.QUOTED).toBe('a # not a comment')
    expect(v.X).toBe('1')
    expect(v.ADMIN_PASSWORD).toBe('')
  })
  it('merges in place keeping comments/order and appends unknown keys under a header', () => {
    const out = mergeEnv(EXAMPLE, { ADMIN_PASSWORD: 'p w', LLM_MODEL: 'qwen2.5:7b-instruct', NEW_KEY: 'x' })
    expect(out).toContain('ADMIN_PASSWORD="p w"')
    expect(out).toContain('LLM_MODEL=qwen2.5:7b-instruct       # ollama model')
    expect(out.indexOf('# Database')).toBe(0)
    expect(out).toMatch(/# ── added by \.\/jobradar ──\nNEW_KEY=x\n$/)
    expect(parseEnv(out).DATABASE_URL).toBe(parseEnv(EXAMPLE).DATABASE_URL)
  })
  it('provision() fills only what is empty: secrets generated once, admin answer applied, nothing clobbered', () => {
    const cur = parseEnv(EXAMPLE)
    const { updates, generated } = provision(cur, { ADMIN_EMAIL: 'me@x.io' })
    expect(Object.keys(updates).sort()).toEqual(['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'APP_URL', 'CONTACT_EMAIL', 'STORAGE_SIGNING_SECRET'])
    expect(updates.CONTACT_EMAIL).toBe('me@x.io')
    expect(updates.STORAGE_SIGNING_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(generated.find((g: any) => g.key === 'ADMIN_PASSWORD').showOnce).toBe(true)
    expect(updates.ADMIN_PASSWORD.length).toBe(16)
    const again = provision({ ...cur, ...updates })
    expect(again.updates).toEqual({})
    expect(genPassword()).toMatch(/^[a-zA-Z0-9]{16}$/)
  })
  it('aiEnv() produces the documented chains and PII policy', () => {
    expect(aiEnv('local')).toEqual({ LLM_PROVIDER: 'ollama', EMBEDDING_PROVIDER: 'ollama' })
    expect(aiEnv('gemini', { GEMINI_API_KEY: 'k' })).toEqual({ LLM_PROVIDER: 'gemini,ollama', EMBEDDING_PROVIDER: 'ollama', GEMINI_API_KEY: 'k' })
    expect(aiEnv('groq')).toMatchObject({ LLM_PROVIDER: 'groq,ollama', LLM_PII_PROVIDERS: 'groq' })
    expect(aiEnv('cloud-only')).toMatchObject({ LLM_PROVIDER: 'cerebras,groq,none', EMBEDDING_PROVIDER: 'none' })
    expect(aiEnv('fast', { CEREBRAS_API_KEY: 'c', GEMINI_API_KEY: 'g' })).toEqual({ LLM_PROVIDER: 'cerebras,gemini,groq,none', LLM_PII_PROVIDERS: 'cerebras,gemini,groq', EMBEDDING_PROVIDER: 'gemini', CEREBRAS_API_KEY: 'c', GEMINI_API_KEY: 'g', GROQ_API_KEY: '' })
    expect(aiEnv('hybrid', { GROQ_API_KEY: 'g' })).toEqual({ LLM_PROVIDER: 'cerebras,groq,ollama', LLM_PII_PROVIDERS: 'cerebras,groq', EMBEDDING_PROVIDER: 'ollama', CEREBRAS_API_KEY: '', GROQ_API_KEY: 'g' })
    expect(() => aiEnv('bogus')).toThrow(/unknown --ai/)
  })
})

describe('plan(): decision table', () => {
  it('fresh laptop (Docker + pnpm, nothing running, no .env): native mode with compose for data services, full bootstrap', () => {
    const p = plan(facts({ envFile: false, missingEnv: ['STORAGE_SIGNING_SECRET', 'ADMIN_PASSWORD'], env: { STORAGE_SIGNING_SECRET: '', ADMIN_PASSWORD: '', CONTACT_EMAIL: '' }, pg: { up: false }, redis: { up: false }, ollama: { up: false, models: [], hasLlmModel: false, hasEmbedModel: false }, deps: { nodeModules: false, prismaGenerated: false, chromium: false } }), {})
    expect(p.refusal).toBeNull()
    expect(p.mode).toBe('native')
    expect(ids(p)).toEqual(['env', 'compose-up', 'wait-infra', 'pnpm-install', 'prisma-generate', 'migrate', 'seed', 'ollama-start', 'ollama-pull', 'chromium', 'app', 'verify'])
    expect(p.steps[1].services).toEqual(['postgres', 'redis'])
    expect(p.steps.find((s: any) => s.id === 'ollama-pull').models).toEqual(['qwen2.5:3b-instruct', 'nomic-embed-text'])
    expect(p.steps.find((s: any) => s.id === 'app')).toMatchObject({ processes: ['web', 'worker'], port: 3000, prod: false, queueMode: 'bullmq' })
    expect(p.envUpdates.STORAGE_SIGNING_SECRET).toBeTruthy()
    expect(p.generated.some((g: any) => g.key === 'ADMIN_PASSWORD')).toBe(true)
    expect(p.supervise).toBe(true)
  })
  it('warm server (everything reachable, deps fresh): only migrate → seed → app → verify; no .env write', () => {
    const p = plan(facts(), {})
    expect(ids(p)).toEqual(['migrate', 'seed', 'app', 'verify'])
    expect(p.envUpdates).toEqual({})
    expect(p.warnings).toEqual([])
  })
  it('nothing to run on: no Postgres, no Docker → refusal with both ways out', () => {
    const p = plan(facts({ docker: null, dockerDaemon: false, pg: { up: false } }), {})
    expect(p.refusal).toMatch(/install Docker.*or point DATABASE_URL/s)
    expect(p.steps).toEqual([])
  })
  it('Docker but no pnpm → docker mode: compose with the ai profile, then health wait; no supervision', () => {
    const p = plan(facts({ pnpm: null, pg: { up: false }, redis: { up: false }, envFile: false }), {})
    expect(p.mode).toBe('docker')
    expect(ids(p)).toEqual(['env', 'compose-up', 'ollama-pull', 'verify'])
    expect(p.steps[1].profiles).toEqual(['ai'])
    expect(p.steps[2]).toMatchObject({ base: 'http://127.0.0.1:11434', models: ['qwen2.5:3b-instruct', 'nomic-embed-text'], wait: true })
    expect(p.supervise).toBe(false)
    const noAi = plan(facts({ pnpm: null, env: { LLM_PROVIDER: 'none', EMBEDDING_PROVIDER: 'none' } }), { mode: 'docker' })
    expect(noAi.steps.find((s: any) => s.id === 'compose-up').profiles).toEqual([])
  })
  it('--mode lite: web only with QUEUE_MODE=inline, Redis ignored, no Chromium step', () => {
    const p = plan(facts({ redis: { up: false }, deps: { chromium: false } }), { mode: 'lite' })
    expect(p.mode).toBe('lite')
    expect(ids(p)).toEqual(['migrate', 'seed', 'app', 'verify'])
    expect(p.steps.find((s: any) => s.id === 'app')).toMatchObject({ processes: ['web'], queueMode: 'inline' })
    expect(p.runtimeEnv.QUEUE_MODE).toBe('inline')
    expect(p.steps.at(-1).worker).toBeNull()
  })
  it('Redis down and no Docker → degrade to inline for this run (not persisted) with a warning', () => {
    const p = plan(facts({ docker: null, dockerDaemon: false, redis: { up: false } }), {})
    expect(p.mode).toBe('native')
    expect(p.runtimeEnv.QUEUE_MODE).toBe('inline')
    expect(p.envUpdates.QUEUE_MODE).toBeUndefined()
    expect(p.warnings.join()).toMatch(/Redis is not reachable/)
    expect(p.steps.find((s: any) => s.id === 'app').processes).toEqual(['web'])
  })
  it('Ollama not installed: AI falls back for this run; --ai gemini persists the chain + key and warns about the missing key', () => {
    const p = plan(facts({ ollamaBin: false, ollama: { up: false, models: [], hasLlmModel: false, hasEmbedModel: false } }), { ai: 'gemini', keys: {} })
    expect(p.envUpdates).toMatchObject({ LLM_PROVIDER: 'gemini,ollama', EMBEDDING_PROVIDER: 'ollama', GEMINI_API_KEY: '' })
    expect(p.runtimeEnv).toMatchObject({ LLM_PROVIDER: 'gemini', EMBEDDING_PROVIDER: 'none' })
    expect(ids(p)).not.toContain('ollama-start')
    expect(p.warnings.join('\n')).toMatch(/GEMINI_API_KEY is empty/)
    expect(p.warnings.join('\n')).toMatch(/Ollama is not installed/)
    const withKey = plan(facts({ ollama: { hasLlmModel: false } }), { ai: 'groq', keys: { GROQ_API_KEY: 'k' } })
    expect(withKey.envUpdates).toMatchObject({ LLM_PROVIDER: 'groq,ollama', LLM_PII_PROVIDERS: 'groq', GROQ_API_KEY: 'k' })
    expect(withKey.steps.find((s: any) => s.id === 'ollama-pull').models).toEqual(['qwen2.5:3b-instruct'])
  })
  it('--prod: builds when missing/stale, refuses a busy port; dev moves to 3001', () => {
    expect(ids(plan(facts(), { prod: true }))).toContain('build')
    expect(ids(plan(facts({ deps: { nextBuild: true, nextBuildStale: false } }), { prod: true }))).not.toContain('build')
    expect(ids(plan(facts({ deps: { nextBuild: true, nextBuildStale: true } }), { prod: true }))).toContain('build')
    expect(plan(facts({ ports: { web: false } }), { prod: true }).refusal).toMatch(/Port 3000 is busy/)
    const dev = plan(facts({ ports: { web: false } }), {})
    expect(dev.webPort).toBe(3001)
    expect(dev.runtimeEnv.APP_URL).toBe('http://localhost:3001')
    expect(dev.steps.at(-1).web).toBe('http://127.0.0.1:3001')
  })
  it('explicit --mode that is impossible is refused with a specific reason', () => {
    expect(plan(facts({ docker: null, dockerDaemon: false }), { mode: 'docker' }).refusal).toMatch(/not installed/)
    expect(plan(facts({ dockerDaemon: false }), { mode: 'docker' }).refusal).toMatch(/daemon is not running/)
    expect(plan(facts({ pnpm: null }), { mode: 'native' }).refusal).toMatch(/pnpm is required/)
  })
  it('--skip-install / --skip-chromium turn steps into warnings', () => {
    const p = plan(facts({ deps: { nodeModules: false, chromium: false } }), { skipInstall: true, skipChromium: true })
    expect(ids(p)).not.toContain('pnpm-install')
    expect(ids(p)).not.toContain('chromium')
    expect(p.warnings.length).toBe(2)
  })
})

describe('steps + supervisor helpers', () => {
  it('composeArgs builds the right docker compose command', () => {
    expect(composeArgs({ services: ['postgres', 'redis'] })).toEqual(['compose', 'up', '-d', 'postgres', 'redis'])
    expect(composeArgs({ profiles: ['ai'] }, { build: true })).toEqual(['compose', '--profile', 'ai', 'up', '-d', '--build'])
  })
  it('appProcesses: dev vs prod commands, env overrides, worker only with bullmq', () => {
    const dev = appProcesses('/repo', { processes: ['web', 'worker'], port: 3001, prod: false, queueMode: 'bullmq' }, { LLM_PROVIDER: 'ollama' })
    expect(dev.map((p: any) => p.name)).toEqual(['web', 'worker'])
    expect(dev[0].args).toContain('dev')
    expect(dev[0].env).toMatchObject({ PORT: '3001', QUEUE_MODE: 'bullmq', APP_NAME: 'web', LOG_FORMAT: 'pretty' })
    expect(dev[1].args[0]).toBe('watch')
    expect(dev[1].health).toBe('http://127.0.0.1:9464/healthz')
    const prod = appProcesses('/repo', { processes: ['web'], port: 3000, prod: true, queueMode: 'inline' }, {})
    expect(prod.length).toBe(1)
    expect(prod[0].args).toContain('start')
    expect(prod[0].env.LOG_FORMAT).toBe('json')
  })
  it('backoff: 1 s → 30 s cap, gives up after 10 restarts in the window', () => {
    expect(backoff(0, 0).delayMs).toBe(1000)
    expect(backoff(3, 3).delayMs).toBe(8000)
    expect(backoff(5, 9).delayMs).toBe(30_000)
    expect(backoff(10, 2)).toEqual({ giveUp: true, delayMs: 0 })
  })
  it('state file round-trips and clears', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jr-launcher-'))
    try {
      expect(readState(dir)).toBeNull()
      writeState(dir, { pid: 1, mode: 'native', children: { web: { pid: 2, health: 'http://x' } } })
      expect(readState(dir)).toMatchObject({ pid: 1, mode: 'native' })
      clearState(dir)
      expect(readState(dir)).toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
