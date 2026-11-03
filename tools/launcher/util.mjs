/** Small helpers for the launcher — zero dependencies, Node ≥ 22. */
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'

const TTY = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s))
export const color = { dim: c(2), bold: c(1), red: c(31), green: c(32), yellow: c(33), blue: c(34), magenta: c(35), cyan: c(36), gray: c(90) }
export const PREFIX_COLORS = ['36', '35', '33', '32', '34', '31']

export const log = {
  info: (m) => console.log(`${color.blue('›')} ${m}`),
  ok: (m) => console.log(`${color.green('✓')} ${m}`),
  warn: (m) => console.log(`${color.yellow('!')} ${m}`),
  err: (m) => console.error(`${color.red('✗')} ${m}`),
  step: (n, total, m) => console.log(`\n${color.bold(`[${n}/${total}] ${m}`)}`),
}

export function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null
}

export function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/** Run a command, stream output with a prefix, resolve with the exit code. */
export function run(cmd, args, { cwd, env, prefix, quiet } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    const tag = prefix ? color.gray(`${prefix} │ `) : ''
    const pipe = (stream, isErr) => {
      let buf = ''
      stream.on('data', (d) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!quiet) (isErr ? process.stderr : process.stdout).write(tag + line + '\n') }
      })
      stream.on('end', () => { if (buf && !quiet) (isErr ? process.stderr : process.stdout).write(tag + buf + '\n') })
    }
    pipe(child.stdout, false); pipe(child.stderr, true)
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(127))
  })
}

export function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (v) => { s.destroy(); resolve(v) }
    s.setTimeout(timeoutMs, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

/**
 * HTTP helpers on node:http (not global fetch) so they keep working when a test double replaces `fetch`
 * in the same process, and so the launcher has no hidden dependency on undici behaviour.
 */
export function httpRequest(url, { method = 'GET', body, headers = {}, timeoutMs = 3000, onLine } = {}) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve({ status: 0, text: '', error: 'bad url' }) }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let buf = ''
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (d) => {
        if (onLine) { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1) } }
        else text += d
      })
      res.on('end', () => { if (onLine && buf) onLine(buf); resolve({ status: res.statusCode ?? 0, text }) })
      res.on('error', (e) => resolve({ status: 0, text: '', error: e.message }))
    })
    req.on('error', (e) => resolve({ status: 0, text: '', error: e.message }))
    if (!onLine) req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

export async function httpOk(url, timeoutMs = 3000) {
  const r = await httpRequest(url, { timeoutMs })
  return r.status >= 200 && r.status < 300
}

export async function httpJson(url, timeoutMs = 3000) {
  const r = await httpRequest(url, { timeoutMs })
  if (r.status < 200 || r.status >= 300) return null
  try { return JSON.parse(r.text) } catch { return null }
}

export async function waitFor(label, probe, { timeoutMs = 120_000, everyMs = 1000 } = {}) {
  const t0 = Date.now()
  let dots = 0
  while (Date.now() - t0 < timeoutMs) {
    if (await probe()) return true
    if (process.stdout.isTTY && ++dots % 5 === 0) process.stdout.write(color.gray('.'))
    await new Promise((r) => setTimeout(r, everyMs))
  }
  return false
}

export function portFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, host, () => s.close(() => resolve(true)))
  })
}

export function parseUrl(u, defaults) {
  try { const x = new URL(u); return { host: x.hostname || defaults.host, port: parseInt(x.port || String(defaults.port), 10), user: decodeURIComponent(x.username), db: x.pathname.replace(/^\//, '') } } catch { return { ...defaults, user: '', db: '' } }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
