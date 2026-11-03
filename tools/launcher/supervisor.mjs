/**
 * Process supervisor: spawns the children, multiplexes logs (prefixed, also to .jobradar/logs/*.log), probes
 * health, restarts with exponential backoff (1 s → 30 s, max 10 restarts / 10 min), and drains on SIGINT/SIGTERM.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { color, PREFIX_COLORS, httpOk, sleep } from './util.mjs'

export const STATE_DIR = '.jobradar'

/** Pure: next restart delay and whether the crash budget is exhausted. */
export function backoff(restartsInWindow, attempt) {
  if (restartsInWindow >= 10) return { giveUp: true, delayMs: 0 }
  return { giveUp: false, delayMs: Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) }
}

export function readState(root) {
  const p = join(root, STATE_DIR, 'state.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}
export function writeState(root, state) {
  mkdirSync(join(root, STATE_DIR), { recursive: true })
  writeFileSync(join(root, STATE_DIR, 'state.json'), JSON.stringify(state, null, 2))
}
export function clearState(root) { const p = join(root, STATE_DIR, 'state.json'); if (existsSync(p)) unlinkSync(p) }

export function pidAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } }

export class Supervisor {
  constructor(root, { onGiveUp, prodJson = false } = {}) {
    this.root = root
    this.children = new Map()
    this.stopping = false
    this.onGiveUp = onGiveUp ?? (() => process.exit(1))
    this.prodJson = prodJson
    mkdirSync(join(root, STATE_DIR, 'logs'), { recursive: true })
    this.width = 0
  }

  /** spec: { name, cmd, args, cwd, env, health?: string (url), color? } */
  add(spec) {
    this.width = Math.max(this.width, spec.name.length)
    const entry = { spec, proc: null, restarts: [], attempt: 0, healthFails: 0, log: createWriteStream(join(this.root, STATE_DIR, 'logs', `${spec.name}.log`), { flags: 'a' }), started: 0 }
    this.children.set(spec.name, entry)
    return entry
  }

  prefix(name, i) { return `\x1b[${PREFIX_COLORS[i % PREFIX_COLORS.length]}m${name.padEnd(this.width)}\x1b[0m ${color.gray('│')} ` }

  startAll() {
    let i = 0
    for (const entry of this.children.values()) this.start(entry, i++)
    this.healthTimer = setInterval(() => void this.probe(), 15_000)
    this.healthTimer.unref()
    this.persist()
  }

  start(entry, idx = 0) {
    if (this.stopping) return
    const { spec } = entry
    const tag = process.stdout.isTTY ? this.prefix(spec.name, idx) : `${spec.name.padEnd(this.width)} | `
    const proc = spawn(spec.cmd, spec.args, { cwd: spec.cwd ?? this.root, env: { ...process.env, ...(spec.env ?? {}), FORCE_COLOR: process.stdout.isTTY ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    entry.proc = proc
    entry.started = Date.now()
    entry.idx = idx
    const pipe = (stream, toErr) => {
      let buf = ''
      stream.on('data', (d) => {
        buf += d
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); this.emit(entry, tag, line, toErr) }
      })
    }
    pipe(proc.stdout, false); pipe(proc.stderr, true)
    proc.on('exit', (code, signal) => {
      entry.proc = null
      if (this.stopping) return
      const now = Date.now()
      entry.restarts = entry.restarts.filter((t) => now - t < 600_000)
      entry.restarts.push(now)
      if (now - entry.started > 120_000) entry.attempt = 0 // ran fine for a while → reset backoff
      const { giveUp, delayMs } = backoff(entry.restarts.length, entry.attempt++)
      this.emit(entry, tag, color.red(`exited (${signal ?? `code ${code}`})${giveUp ? ' — crash budget exhausted (10 restarts / 10 min); giving up' : ` — restarting in ${Math.round(delayMs / 1000)} s`}`), true)
      if (giveUp) { this.onGiveUp(spec.name); return }
      setTimeout(() => this.start(entry, idx), delayMs).unref()
    })
    proc.on('error', (err) => this.emit(entry, tag, color.red(`failed to spawn: ${err.message}`), true))
  }

  emit(entry, tag, line, toErr) {
    entry.log.write(line + '\n')
    ;(toErr ? process.stderr : process.stdout).write(tag + line + '\n')
  }

  async probe() {
    for (const entry of this.children.values()) {
      if (!entry.spec.health || !entry.proc || Date.now() - entry.started < 60_000) continue
      const ok = await httpOk(entry.spec.health, 4000)
      entry.healthFails = ok ? 0 : entry.healthFails + 1
      if (entry.healthFails >= 3) {
        this.emit(entry, this.prefix(entry.spec.name, entry.idx ?? 0), color.yellow(`health probe ${entry.spec.health} failed 3× — restarting`), true)
        entry.healthFails = 0
        entry.proc.kill('SIGTERM')
      }
    }
  }

  persist(extra = {}) {
    writeState(this.root, { pid: process.pid, startedAt: new Date().toISOString(), children: Object.fromEntries([...this.children].map(([n, e]) => [n, { pid: e.proc?.pid ?? null, health: e.spec.health ?? null }])), ...extra })
  }

  async stop(timeoutMs = 30_000) {
    if (this.stopping) return
    this.stopping = true
    clearInterval(this.healthTimer)
    const live = [...this.children.values()].filter((e) => e.proc)
    for (const e of live) e.proc.kill('SIGTERM')
    const t0 = Date.now()
    while (live.some((e) => e.proc) && Date.now() - t0 < timeoutMs) await sleep(200)
    for (const e of live) if (e.proc) e.proc.kill('SIGKILL')
    for (const e of this.children.values()) e.log.end()
    clearState(this.root)
  }
}
