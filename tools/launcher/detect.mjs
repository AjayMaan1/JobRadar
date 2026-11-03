/** Doctor: observe the machine and the checkout. No side effects. */
import { existsSync, statSync, readdirSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { httpJson, parseUrl, portFree, runSync, tcpOpen, which } from './util.mjs'
import { readEnvFile, parseEnv, REQUIRED } from './env.mjs'
import { readFileSync } from 'node:fs'

function version(cmd, args = ['--version']) {
  const r = runSync(cmd, args)
  return r.code === 0 ? (r.out || r.err).split('\n')[0].replace(/^v/, '') : null
}

function newest(dir, exts) {
  let t = 0
  const walk = (d, depth) => {
    if (depth > 6) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (exts.some((x) => e.name.endsWith(x))) t = Math.max(t, statSync(p).mtimeMs)
    }
  }
  try { walk(dir, 0) } catch { /* ignore */ }
  return t
}

export async function detect(root, { env: envOverride } = {}) {
  const envFile = readEnvFile(root)
  const example = existsSync(join(root, '.env.example')) ? parseEnv(readFileSync(join(root, '.env.example'), 'utf8')) : {}
  const env = { ...example, ...envFile.values, ...(envOverride ?? {}) }
  const pg = parseUrl(env.DATABASE_URL ?? REQUIRED.DATABASE_URL.default, { host: 'localhost', port: 5432 })
  const rd = parseUrl(env.REDIS_URL ?? REQUIRED.REDIS_URL.default, { host: 'localhost', port: 6379 })
  const ollamaBase = (env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
  const ol = parseUrl(ollamaBase, { host: '127.0.0.1', port: 11434 })
  const dockerCompose = (() => { const r = runSync('docker', ['compose', 'version']); return r.code === 0 ? r.out.replace(/^Docker Compose version\s*/i, '') : null })()
  const dockerDaemon = dockerCompose ? runSync('docker', ['info', '--format', '{{.ServerVersion}}']).code === 0 : false
  const [pgUp, redisUp, ollamaUp, port3000, port9464] = await Promise.all([tcpOpen(pg.host, pg.port), tcpOpen(rd.host, rd.port), tcpOpen(ol.host, ol.port), portFree(3000), portFree(9464)])
  const tags = ollamaUp ? await httpJson(`${ollamaBase}/api/tags`, 2000) : null
  const models = (tags?.models ?? []).map((m) => m.name)
  const hasModel = (want) => Boolean(want) && models.some((m) => m === want || m === `${want}:latest` || m.startsWith(`${want}:`))
  const llmIds = String(env.LLM_PROVIDER ?? 'cerebras,gemini,groq,none').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  const wantsOllama = llmIds.includes('ollama') || (env.EMBEDDING_PROVIDER ?? 'gemini') === 'ollama'
  const nodeModules = existsSync(join(root, 'node_modules', '.pnpm')) || existsSync(join(root, 'node_modules', 'next', 'package.json'))
  const lockMtime = existsSync(join(root, 'pnpm-lock.yaml')) ? statSync(join(root, 'pnpm-lock.yaml')).mtimeMs : 0
  const nmMtime = existsSync(join(root, 'node_modules', '.modules.yaml')) ? statSync(join(root, 'node_modules', '.modules.yaml')).mtimeMs : 0
  const prismaGenerated = existsSync(join(root, 'packages', 'db', 'generated', 'prisma', 'index.js'))
  const nextBuild = existsSync(join(root, 'apps', 'web', '.next', 'BUILD_ID'))
  const nextBuildMtime = nextBuild ? statSync(join(root, 'apps', 'web', '.next', 'BUILD_ID')).mtimeMs : 0
  const srcMtime = newest(join(root, 'apps', 'web'), ['.ts', '.tsx', '.css'])
  const pwCache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright')
  const chromium = existsSync(pwCache) && readdirSync(pwCache).some((d) => d.startsWith('chromium'))
  const missingEnv = Object.keys(REQUIRED).filter((k) => !env[k])
  const keys = Object.fromEntries(['GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].map((k) => [k, Boolean(env[k])]))

  return {
    root,
    node: process.version.replace(/^v/, ''),
    pnpm: version('pnpm'), docker: dockerCompose, dockerDaemon, ollamaBin: Boolean(which('ollama')), psqlBin: Boolean(which('psql')),
    cpus: os.cpus().length, memGb: Math.round(os.totalmem() / 1e9), platform: process.platform,
    envFile: envFile.exists, missingEnv, env,
    pg: { ...pg, up: pgUp }, redis: { ...rd, up: redisUp },
    ollama: { base: ollamaBase, up: ollamaUp, models, wanted: wantsOllama, llmModel: env.LLM_MODEL ?? 'qwen2.5:3b-instruct', embedModel: env.EMBEDDING_MODEL ?? 'nomic-embed-text', hasLlmModel: hasModel(env.LLM_MODEL ?? 'qwen2.5:3b-instruct'), hasEmbedModel: hasModel(env.EMBEDDING_MODEL ?? 'nomic-embed-text') },
    llm: { ids: llmIds, keys, embedding: env.EMBEDDING_PROVIDER ?? 'gemini' },
    deps: { nodeModules, stale: nodeModules && lockMtime > nmMtime, prismaGenerated, nextBuild, nextBuildStale: nextBuild && srcMtime > nextBuildMtime, chromium },
    ports: { web: port3000, worker: port9464 },
    queueMode: env.QUEUE_MODE ?? 'bullmq',
  }
}

/** Human table for `./jobradar doctor`. */
export function formatDoctor(f) {
  const yn = (v, good = 'yes', bad = 'no') => (v ? good : bad)
  const rows = [
    ['Node', f.node], ['pnpm', f.pnpm ?? 'missing'], ['Docker Compose', f.docker ? `${f.docker}${f.dockerDaemon ? '' : ' (daemon not running)'}` : 'missing'],
    ['CPU / RAM', `${f.cpus} cores / ${f.memGb} GB`],
    ['.env', f.envFile ? (f.missingEnv.length ? `missing: ${f.missingEnv.join(', ')}` : 'complete') : 'absent (will be created from .env.example)'],
    ['Postgres', `${f.pg.host}:${f.pg.port} ${yn(f.pg.up, 'reachable', 'not reachable')}`],
    ['Redis', `${f.redis.host}:${f.redis.port} ${yn(f.redis.up, 'reachable', 'not reachable')}${f.queueMode === 'inline' ? ' (not needed: QUEUE_MODE=inline)' : ''}`],
    ['Ollama', f.ollama.wanted ? `${f.ollama.base} ${yn(f.ollama.up, 'reachable', 'not reachable')} · binary ${yn(f.ollamaBin)} · models: ${f.ollama.models.join(', ') || 'none'}` : 'not used by the configured providers'],
    ['LLM providers', `${f.llm.ids.join(' → ')}${Object.entries(f.llm.keys).filter(([, v]) => v).length ? ` · keys: ${Object.entries(f.llm.keys).filter(([, v]) => v).map(([k]) => k).join(', ')}` : ''}`],
    ['Embeddings', f.llm.embedding],
    ['node_modules', f.deps.nodeModules ? (f.deps.stale ? 'present (lockfile newer → reinstall)' : 'present') : 'missing'],
    ['Prisma client', yn(f.deps.prismaGenerated, 'generated', 'not generated')],
    ['Web build', f.deps.nextBuild ? (f.deps.nextBuildStale ? 'stale' : 'fresh') : 'none (dev mode or build on --prod)'],
    ['Chromium (PDF)', yn(f.deps.chromium, 'installed', 'missing → simple renderer')],
    ['Ports', `3000 ${yn(f.ports.web, 'free', 'busy')} · 9464 ${yn(f.ports.worker, 'free', 'busy')}`],
  ]
  const w = Math.max(...rows.map((r) => r[0].length))
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n')
}
