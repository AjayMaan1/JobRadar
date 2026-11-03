/**
 * Supervisor with real child processes: a healthy HTTP child, a crash-looping child (restarts with backoff),
 * graceful stop on SIGTERM, state file and per-child log files.
 *   tsx tools/testkit/run-tests.ts launcher-supervisor tools/launcher/supervisor.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { Supervisor, readState, STATE_DIR } from './supervisor.mjs'
// @ts-ignore
import { httpOk, waitFor, portFree } from './util.mjs'

const SERVER = `
const http = require('node:http');
const s = http.createServer((req, res) => { res.writeHead(req.url === '/login' ? 200 : 404); res.end('ok') });
s.listen(process.env.PORT, '127.0.0.1', () => console.log('listening ' + process.env.PORT));
process.on('SIGTERM', () => { console.log('bye'); s.close(() => process.exit(0)) });
`
const CRASHER = `console.error('boom'); process.exit(3)`

describe('Supervisor (real children)', () => {
  it('starts children, restarts a crasher with backoff, probes health, stops gracefully and clears state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jr-sup-'))
    let port = 18200
    while (!(await portFree(port))) port++
    const sup = new Supervisor(dir, { onGiveUp: () => undefined })
    sup.add({ name: 'web', cmd: process.execPath, args: ['-e', SERVER], env: { PORT: String(port) }, health: `http://127.0.0.1:${port}/login` })
    sup.add({ name: 'worker', cmd: process.execPath, args: ['-e', CRASHER] })
    const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    ;(process.stdout as any).write = (s: string) => { captured.push(String(s)); return true }
    ;(process.stderr as any).write = (s: string) => { captured.push(String(s)); return true }
    try {
      sup.startAll()
      expect(await waitFor('web', () => httpOk(`http://127.0.0.1:${port}/login`), { timeoutMs: 15_000, everyMs: 200 })).toBe(true)
      const state = readState(dir)
      expect(state.children.web.health).toBe(`http://127.0.0.1:${port}/login`)
      // crasher: exits immediately → restart after 1 s, then 2 s …
      await new Promise((r) => setTimeout(r, 3600))
      const worker = sup.children.get('worker')
      expect(worker.restarts.length).toBeGreaterThanOrEqual(2)
      expect(worker.restarts.length).toBeLessThan(10)
      expect(captured.join('')).toMatch(/boom/)
      expect(captured.join('')).toMatch(/restarting in 1 s/)
      await sup.stop(10_000)
      expect(sup.children.get('web').proc).toBeNull()
      expect(readState(dir)).toBeNull()
      expect(await httpOk(`http://127.0.0.1:${port}/login`, 500)).toBe(false)
      const webLog = readFileSync(join(dir, STATE_DIR, 'logs', 'web.log'), 'utf8')
      expect(webLog).toMatch(/listening/)
      expect(webLog).toMatch(/bye/) // SIGTERM handled, graceful exit
      expect(existsSync(join(dir, STATE_DIR, 'logs', 'worker.log'))).toBe(true)
    } finally {
      ;(process.stdout as any).write = origOut
      ;(process.stderr as any).write = origErr
      await sup.stop(2000).catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
