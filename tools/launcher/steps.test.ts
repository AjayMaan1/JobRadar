/** Step executors against local doubles: Ollama pull (NDJSON progress) and .env write. */
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { stepOllamaPull, stepEnv } from './steps.mjs'
// @ts-ignore
import { parseEnv } from './env.mjs'

describe('stepOllamaPull', () => {
  it('skips present models, streams progress for missing ones, fails on an error line', async () => {
    const pulled: string[] = []
    const server = http.createServer((req, res) => {
      if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] })) }
      if (req.url === '/api/pull') {
        let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
          const { model } = JSON.parse(b); pulled.push(model)
          res.setHeader('content-type', 'application/x-ndjson')
          if (model === 'broken') { res.end(JSON.stringify({ error: 'pull model manifest: not found' }) + '\n'); return }
          for (let i = 1; i <= 10; i++) res.write(JSON.stringify({ status: 'pulling', total: 100, completed: i * 10 }) + '\n')
          res.end(JSON.stringify({ status: 'success' }) + '\n')
        }); return
      }
      res.writeHead(404); res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    const out: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    ;(process.stdout as any).write = (s: string) => { out.push(String(s)); return true }
    const origLog = console.log
    console.log = (...a: any[]) => { out.push(a.join(' ')) }
    try {
      expect(await stepOllamaPull({ base, models: ['nomic-embed-text', 'qwen2.5:3b-instruct'], wait: true })).toBe(true)
      expect(pulled).toEqual(['qwen2.5:3b-instruct'])
      expect(out.join('')).toMatch(/already present/)
      expect(out.join('')).toMatch(/50%.*100%/s)
      expect(await stepOllamaPull({ base, models: ['broken'] })).toBe(false)
      expect(out.join('')).toMatch(/failed: pull model manifest/)
    } finally {
      ;(process.stdout as any).write = orig
      console.log = origLog
      server.close()
    }
  })
})

describe('stepEnv', () => {
  it('creates .env from .env.example on first run and merges the planned updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jr-env-'))
    try {
      writeFileSync(join(dir, '.env.example'), 'ADMIN_EMAIL=you@example.com\nADMIN_PASSWORD=\nLLM_PROVIDER=ollama\n')
      await stepEnv(dir, { envUpdates: { ADMIN_PASSWORD: 'secret1234567', LLM_PROVIDER: 'gemini,ollama', GEMINI_API_KEY: 'k' } })
      const v = parseEnv(readFileSync(join(dir, '.env'), 'utf8'))
      expect(v).toEqual({ ADMIN_EMAIL: 'you@example.com', ADMIN_PASSWORD: 'secret1234567', LLM_PROVIDER: 'gemini,ollama', GEMINI_API_KEY: 'k' })
      await stepEnv(dir, { envUpdates: {} }) // idempotent
      expect(parseEnv(readFileSync(join(dir, '.env'), 'utf8')).ADMIN_PASSWORD).toBe('secret1234567')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
