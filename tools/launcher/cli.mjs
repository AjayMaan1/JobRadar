#!/usr/bin/env node
/**
 * JobRadar launcher — one entry point for the whole system (docs/HLD-unified-launcher.md).
 *
 *   ./jobradar up [--mode auto|native|docker|lite] [--prod] [--ai local|gemini|groq|cerebras|mistral|openrouter|cloud-only|none]
 *                 [--admin you@example.com] [--yes] [--dry-run] [--skip-install] [--skip-chromium] [--keep-infra]
 *   ./jobradar down            stop what `up` started (app processes, managed Ollama; compose services unless --keep-infra)
 *   ./jobradar status          what is running, ports, health
 *   ./jobradar doctor          prerequisites and reachability table, no changes
 *   ./jobradar logs [name]     tail .jobradar/logs/*.log
 *   ./jobradar ai setup|test   choose / validate AI providers (docs/AI-PROVIDERS.md)
 *   ./jobradar systemd         print a single systemd unit that runs `./jobradar up --prod`
 *
 * Plain Node ≥ 22, no dependencies — it runs before `pnpm install`.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { detect, formatDoctor } from './detect.mjs'
import { plan, formatPlan, MODES } from './plan.mjs'
import { AI_CHOICES, AI_KEY_FOR, AI_KEYS_FOR, aiEnv, mergeEnv, readEnvFile, writeEnvFile } from './env.mjs'
import { Supervisor, readState, clearState, pidAlive, STATE_DIR } from './supervisor.mjs'
import { appProcesses, readEnvForChildren, stepChromium, stepComposeUp, stepEnv, stepOllamaPull, stepOllamaStart, stepPnpm, stepWaitInfra } from './steps.mjs'
import { color, httpOk, log, run, waitFor } from './util.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function parseArgs(argv) {
  const flags = { _: [], keys: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { flags._.push(a); continue }
    const [k, inline] = a.slice(2).split('=')
    const next = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true')
    const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (/^[A-Z_]+_API_KEY$/.test(k)) flags.keys[k] = next
    else flags[camel] = next === 'true' ? true : next === 'false' ? false : next
  }
  return flags
}

async function ask(question, { secret = false, def = '' } = {}) {
  if (!process.stdin.isTTY) return def
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (secret) process.stdout.write(`${question}${def ? ` [${def}]` : ''}: `)
    const a = secret ? await new Promise((res) => { const chars = []; process.stdin.setRawMode(true); process.stdin.resume(); const onData = (d) => { const s = d.toString(); if (s === '\r' || s === '\n') { process.stdin.setRawMode(false); process.stdin.off('data', onData); process.stdout.write('\n'); res(chars.join('')) } else if (s === '\u0003') process.exit(130); else if (s === '\u007f') chars.pop(); else chars.push(s) }; process.stdin.on('data', onData) }) : await rl.question(`${question}${def ? ` [${def}]` : ''}: `)
    return a.trim() || def
  } finally { rl.close() }
}

// ── commands ───────────────────────────────────────────────────────────────────────────────────────────

async function cmdDoctor() {
  const facts = await detect(ROOT)
  console.log(color.bold('JobRadar doctor'))
  console.log(formatDoctor(facts))
  const p = plan(facts, {})
  console.log()
  if (p.refusal) log.err(p.refusal)
  else { log.info(`\`./jobradar up\` would run in ${color.bold(p.mode)} mode:`); console.log(formatPlan(p)) }
  return p.refusal ? 1 : 0
}

async function cmdUp(flags) {
  if (flags.mode && !MODES.includes(flags.mode)) { log.err(`--mode must be one of ${MODES.join(', ')}`); return 2 }
  if (flags.ai && !AI_CHOICES.includes(flags.ai)) { log.err(`--ai must be one of ${AI_CHOICES.join(', ')}`); return 2 }
  const existing = readState(ROOT)
  if (existing && pidAlive(existing.pid) && existing.pid !== process.pid) { log.warn(`already running (launcher pid ${existing.pid}) — ./jobradar status | ./jobradar down`); return 0 }
  if (existing) clearState(ROOT)

  let facts = await detect(ROOT)
  // first run, interactive: ask the two questions that matter (admin e-mail, AI choice) unless --yes / flags
  const firstRun = !facts.envFile || facts.missingEnv.includes('ADMIN_EMAIL')
  if (firstRun && !flags.yes && !flags.admin && process.stdin.isTTY) flags.admin = await ask('Admin e-mail (your login)', { def: 'owner@jobradar.local' })
  if (firstRun && !flags.yes && !flags.ai && process.stdin.isTTY) {
    console.log(color.gray('  AI: local = Ollama on this box (private; minutes per call on a 2-core CPU) · fast = hosted free tiers, no Ollama (seconds) · hybrid = no-training tiers + local fallback · gemini = public inputs only · none = deterministic. docs/AI-PROVIDERS.md'))
    flags.ai = await ask(`AI provider (${AI_CHOICES.join(' | ')})`, { def: facts.ollama.up && facts.ollama.hasLlmModel ? 'local' : 'fast' })
  }
  const keysNeeded = AI_KEYS_FOR[flags.ai] ?? (flags.ai && AI_KEY_FOR[flags.ai] ? [AI_KEY_FOR[flags.ai]] : [])
  for (const k of keysNeeded) {
    if (flags.keys[k] || facts.env[k]) continue
    const v = process.stdin.isTTY && !flags.yes ? await ask(`${k}`, { secret: true }) : ''
    if (v) flags.keys[k] = v; else log.warn(`${k} not provided — that provider will be skipped by the chain until you add it to .env (./jobradar ai setup)`)
  }

  const planned = plan(facts, flags)
  console.log(color.bold(`\nJobRadar up — ${planned.refusal ? 'cannot start' : `mode ${planned.mode}`}`))
  if (planned.refusal) { log.err(planned.refusal); return 1 }
  console.log(formatPlan(planned))
  if (flags.dryRun) { log.info('--dry-run: nothing executed'); return 0 }

  const sup = new Supervisor(ROOT, { prodJson: Boolean(flags.prod) })
  const started = { compose: [] }
  const total = planned.steps.length
  let n = 0
  for (const step of planned.steps) {
    log.step(++n, total, step.title)
    let ok = true
    switch (step.id) {
      case 'env': ok = await stepEnv(ROOT, planned); break
      case 'compose-up': ok = await stepComposeUp(ROOT, step, { build: planned.mode === 'docker' }); if (ok) started.compose.push(...(step.services ?? ['all'])); break
      case 'wait-infra': ok = await stepWaitInfra(facts, step); break
      case 'pnpm-install': ok = await stepPnpm(ROOT, ['install', '--frozen-lockfile']); break
      case 'prisma-generate': ok = await stepPnpm(ROOT, ['db:generate']); break
      case 'migrate': ok = await stepPnpm(ROOT, ['db:migrate:deploy'], 'prisma'); break
      case 'seed': ok = await stepPnpm(ROOT, ['db:seed'], 'seed'); if (!ok) { log.warn('seed failed — continuing (host policies can be seeded later with pnpm db:seed)'); ok = true } break
      case 'ollama-start': ok = await stepOllamaStart(ROOT, step, sup); break
      case 'ollama-pull': ok = await stepOllamaPull(step); if (!ok) { log.warn('model pull failed — AI calls will fail until the model exists; re-run ./jobradar up'); ok = true } break
      case 'chromium': ok = await stepChromium(ROOT); break
      case 'build': ok = await stepPnpm(ROOT, ['--filter', '@jobradar/web', 'build'], 'next build'); break
      case 'app': {
        const env = { ...readEnvForChildren(ROOT), ...planned.runtimeEnv }
        for (const spec of appProcesses(ROOT, step, env)) sup.add(spec)
        sup.startAll()
        sup.persist({ mode: planned.mode, compose: started.compose, keepInfra: Boolean(flags.keepInfra) || planned.mode === 'native', webPort: step.port })
        break
      }
      case 'verify': {
        process.stdout.write(`  web ${step.web}/login `)
        const webOk = await waitFor('web', () => httpOk(`${step.web}/login`, 3000), { timeoutMs: planned.mode === 'docker' ? 600_000 : 180_000 })
        console.log(webOk ? color.green('ready') : color.red('not responding'))
        if (step.worker) { process.stdout.write(`  worker ${step.worker}/healthz `); const w = await waitFor('worker', () => httpOk(`${step.worker}/healthz`, 3000), { timeoutMs: 180_000 }); console.log(w ? color.green('ready') : color.yellow('not responding yet (check logs)')) }
        ok = webOk
        break
      }
      default: log.warn(`unknown step ${step.id}`)
    }
    if (!ok) { log.err(`step failed: ${step.title}`); if (planned.supervise) await sup.stop(); return 1 }
  }

  const env = readEnvForChildren(ROOT)
  const url = planned.webPort ? `http://localhost:${planned.webPort}` : env.APP_URL || 'http://localhost:3000'
  console.log(`\n${color.green(color.bold('JobRadar is up'))}  →  ${color.bold(url)}`)
  if (planned.generated.some((g) => g.showOnce)) {
    console.log(color.yellow('\n  First-run credentials (shown once; also in .env):'))
    console.log(`    e-mail:    ${env.ADMIN_EMAIL}`)
    for (const g of planned.generated.filter((x) => x.showOnce)) console.log(`    password:  ${g.value}`)
  }
  if (planned.mode === 'docker') { console.log(color.gray('  docker compose ps · docker compose logs -f web worker · ./jobradar down')); return 0 }
  console.log(color.gray(`  logs: .jobradar/logs/*.log · ./jobradar status · Ctrl-C or ./jobradar down to stop`))
  if (planned.runtimeEnv.LLM_PROVIDER) console.log(color.gray('  AI is off for this run (Ollama not installed). ./jobradar ai setup to pick a provider.'))

  // supervise until a signal
  await new Promise((resolveStop) => {
    const stop = async (sig) => { console.log(`\n${color.gray(`${sig} — stopping`)}`); await sup.stop(); resolveStop() }
    process.on('SIGINT', () => void stop('SIGINT'))
    process.on('SIGTERM', () => void stop('SIGTERM'))
    sup.onGiveUp = async (name) => { log.err(`${name} keeps crashing — stopping everything (see .jobradar/logs/${name}.log)`); await sup.stop(); process.exit(1) }
  })
  return 0
}

async function cmdDown(flags) {
  const state = readState(ROOT)
  if (!state) {
    // docker mode leaves no launcher pid: stop compose if a project is running
    const r = await run('docker', ['compose', 'ps', '-q'], { cwd: ROOT, quiet: true })
    if (r === 0) { log.info('stopping compose services'); await run('docker', ['compose', '--profile', 'ai', 'down'], { cwd: ROOT, prefix: 'docker' }) }
    else log.info('nothing recorded as running')
    return 0
  }
  if (pidAlive(state.pid)) {
    log.info(`stopping launcher pid ${state.pid}`)
    process.kill(state.pid, 'SIGTERM')
    const gone = await waitFor('launcher', async () => !pidAlive(state.pid), { timeoutMs: 40_000, everyMs: 500 })
    if (!gone) { log.warn('launcher did not exit — killing'); process.kill(state.pid, 'SIGKILL') }
  } else {
    for (const [name, c] of Object.entries(state.children ?? {})) if (c.pid && pidAlive(c.pid)) { log.info(`killing orphan ${name} (${c.pid})`); try { process.kill(c.pid, 'SIGTERM') } catch { /* gone */ } }
  }
  if (state.compose?.length && !(flags.keepInfra ?? state.keepInfra)) await run('docker', ['compose', 'stop', ...state.compose.filter((s) => s !== 'all')], { cwd: ROOT, prefix: 'docker' })
  clearState(ROOT)
  log.ok('stopped')
  return 0
}

async function cmdStatus() {
  const state = readState(ROOT)
  if (!state) { log.info('not running (no .jobradar/state.json)'); const facts = await detect(ROOT); console.log(formatDoctor(facts)); return 0 }
  console.log(`${color.bold('launcher')} pid ${state.pid} ${pidAlive(state.pid) ? color.green('alive') : color.red('dead')} · mode ${state.mode} · since ${state.startedAt}`)
  for (const [name, c] of Object.entries(state.children ?? {})) {
    const alive = c.pid ? pidAlive(c.pid) : false
    const health = c.health ? (await httpOk(c.health, 2000) ? color.green('healthy') : color.red('unhealthy')) : ''
    console.log(`  ${name.padEnd(8)} pid ${String(c.pid ?? '-').padEnd(7)} ${alive ? color.green('running') : color.red('stopped')} ${health} ${color.gray(c.health ?? '')}`)
  }
  if (state.webPort) console.log(`  web → http://localhost:${state.webPort}`)
  return 0
}

function cmdLogs(flags) {
  const dir = join(ROOT, STATE_DIR, 'logs')
  if (!existsSync(dir)) { log.info('no logs yet'); return 0 }
  const names = flags._[1] ? [flags._[1]] : readdirSync(dir).map((f) => f.replace(/\.log$/, ''))
  const files = names.map((n) => join(dir, `${n}.log`)).filter(existsSync)
  if (!files.length) { log.info('no such log'); return 1 }
  const tail = spawn('tail', ['-n', '80', '-F', ...files], { stdio: 'inherit' })
  return new Promise((r) => tail.on('exit', (c) => r(c ?? 0)))
}

async function cmdAi(flags) {
  const sub = flags._[1] ?? 'setup'
  if (sub === 'test') {
    // one cheap status request per configured provider through the real package (needs node_modules)
    const tsx = join(ROOT, 'node_modules', '.bin', 'tsx')
    if (!existsSync(tsx)) { log.err('run pnpm install first (needs @jobradar/llm)'); return 1 }
    return run(tsx, ['-e', `import('dotenv/config').then(()=>import('@jobradar/llm')).then(async ({describeLlm})=>{const s=await describeLlm();for(const p of s.providers)console.log(p.name.padEnd(10),p.kind.padEnd(6),(p.model??'').padEnd(28),p.reachable===null?'configured':p.reachable?'reachable':'UNREACHABLE',p.detail??'',p.quota?\`quota \${p.quota.usedToday}/\${p.quota.rpd||'∞'}\`:'', p.piiAllowed?'':'(public inputs only)')})`], { cwd: ROOT })
  }
  console.log(color.bold('AI provider setup') + color.gray('  — docs/AI-PROVIDERS.md'))
  console.log(['  local       Ollama on this box. Private. Minutes per call on a 2-core CPU, seconds with a GPU / Apple Silicon.',
    '  fast        Speed first, no Ollama needed: cerebras → gemini (→ groq if a key is present) → deterministic; embeddings on Gemini. Keys: cloud.cerebras.ai, aistudio.google.com',
    '  hybrid      Privacy-conscious on 2-core laptops: cerebras → groq (both no-training) → local Ollama fallback; embeddings local. Keys: cloud.cerebras.ai, console.groq.com',
    '  gemini      Google free tier for job-description analysis (seconds); resume text stays local. Key: aistudio.google.com',
    '  groq        Free 70B tier, no-training policy → also allowed for resume text. Key: console.groq.com',
    '  cerebras    Same idea as groq, larger daily token allowance. Key: cloud.cerebras.ai',
    '  mistral     Free plan (training opt-in) → public inputs only.',
    '  openrouter  Rotating free models, 50 req/day → experiments only.',
    '  cloud-only  No Ollama at all: cerebras → groq → deterministic.',
    '  none        Deterministic features only.'].join('\n'))
  const choice = flags.ai ?? (await ask(`Choice (${AI_CHOICES.join(' | ')})`, { def: 'local' }))
  if (!AI_CHOICES.includes(choice)) { log.err('unknown choice'); return 2 }
  const keys = { ...flags.keys }
  const need = AI_KEYS_FOR[choice] ?? (AI_KEY_FOR[choice] ? [AI_KEY_FOR[choice]] : [])
  const current = readEnvFile(ROOT)
  for (const k of need) if (!keys[k] && !current.values[k]) keys[k] = await ask(k, { secret: true })
  const updates = aiEnv(choice, keys)
  for (const k of Object.keys(updates)) if (updates[k] === '' && current.values[k]) delete updates[k]
  if (!current.exists) { log.err('.env does not exist yet — run ./jobradar up first'); return 1 }
  writeEnvFile(ROOT, mergeEnv(current.text, updates))
  log.ok(`wrote ${Object.keys(updates).join(', ')} to .env`)
  if (readState(ROOT)) log.info('restart to apply: ./jobradar down && ./jobradar up')
  return 0
}

function cmdSystemd() {
  const user = process.env.SUDO_USER || process.env.USER || 'jobradar'
  console.log(`# /etc/systemd/system/jobradar.service — one unit for the whole system (replaces jobradar-web + jobradar-worker)
[Unit]
Description=JobRadar (web + worker + managed Ollama) via ./jobradar up
After=network-online.target docker.service postgresql.service redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${ROOT}
Environment=NODE_ENV=production LOG_FORMAT=json
ExecStart=${process.execPath} ${join(ROOT, 'tools/launcher/cli.mjs')} up --prod --mode native --yes --skip-chromium
ExecStop=${process.execPath} ${join(ROOT, 'tools/launcher/cli.mjs')} down --keep-infra
Restart=always
RestartSec=10
KillMode=mixed
TimeoutStopSec=45
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
# sudo systemctl daemon-reload && sudo systemctl enable --now jobradar && journalctl -u jobradar -f`)
  return 0
}

function help() {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^ \*\s?/, '')).join('\n'))
  return 0
}

const flags = parseArgs(process.argv.slice(2))
const cmd = flags._[0] ?? 'help'
mkdirSync(join(ROOT, STATE_DIR), { recursive: true })
const table = { up: () => cmdUp(flags), down: () => cmdDown(flags), status: cmdStatus, doctor: cmdDoctor, logs: () => cmdLogs(flags), ai: () => cmdAi(flags), systemd: cmdSystemd, help, '--help': help, '-h': help }
const fn = table[cmd]
if (!fn) { log.err(`unknown command "${cmd}"`); help(); process.exit(2) }
Promise.resolve(fn()).then((code) => { if (cmd !== 'up' || code !== 0) process.exit(code ?? 0); else process.exit(0) }).catch((err) => { log.err(err.stack ?? String(err)); process.exit(1) })
