import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * GH-4: docs/openapi.json must describe every route handler (and nothing that no longer exists). The spec is
 * hand-maintained; this test turns "forgot to update the docs" into a red build.
 */
const API_ROOT = resolve(__dirname, '../app/api')
const spec = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/openapi.json'), 'utf8')) as { paths: Record<string, Record<string, unknown>> }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

function routePath(file: string): string {
  return ('/api' + file.slice(API_ROOT.length).replace(/\/route\.ts$/, '')).replace(/\[([a-zA-Z]+)\]/g, '{$1}')
}

describe('OpenAPI ↔ routes', () => {
  const files = walk(API_ROOT)
  it('covers every route file and method', () => {
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const methods = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)].map((m) => m[1].toLowerCase())
      const path = routePath(f)
      for (const m of methods) if (!spec.paths[path]?.[m]) missing.push(`${m.toUpperCase()} ${path}`)
    }
    expect(missing, `undocumented: ${missing.join(', ')}`).toEqual([])
  })
  it('documents no phantom routes', () => {
    const real = new Set(files.map(routePath))
    const phantom = Object.keys(spec.paths).filter((p) => !real.has(p))
    expect(phantom, `in spec but no route file: ${phantom.join(', ')}`).toEqual([])
  })
  it('every operation declares security and responses', () => {
    for (const [p, ops] of Object.entries(spec.paths)) for (const [m, o] of Object.entries(ops)) {
      const op = o as { security?: unknown[]; responses?: Record<string, unknown> }
      expect(Array.isArray(op.security), `${m} ${p} security`).toBe(true)
      expect(Object.keys(op.responses ?? {}).length, `${m} ${p} responses`).toBeGreaterThan(0)
    }
  })
})
