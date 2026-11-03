import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { log, m } from '@jobradar/log'
import type { JsonRequest, JsonResult, LlmProvider, LlmUsage } from './types.js'
import { LlmError } from './types.js'

/** The slice of Redis the budget needs — so inline mode (no Redis) gets a real budget too (audit NEW-04). */
export interface BudgetStore {
  get(key: string): Promise<string | null>
  multi(): { incr(k: string): unknown; expire(k: string, ttl: number): unknown; incrbyfloat(k: string, n: number): unknown; hincrby(k: string, f: string, n: number): unknown; exec(): Promise<unknown> }
  hgetall(key: string): Promise<Record<string, string>>
  setex?(key: string, ttl: number, value: string): Promise<unknown>
}

/** In-memory BudgetStore: per-process counters with TTL. Good enough for QUEUE_MODE=inline on one box. */
export class MemoryBudgetStore implements BudgetStore {
  private kv = new Map<string, { v: string; exp: number | null }>()
  private hashes = new Map<string, Record<string, string>>()
  private alive(k: string) { const e = this.kv.get(k); if (e && e.exp !== null && e.exp <= Date.now()) { this.kv.delete(k); return undefined } return e }
  async get(k: string) { return this.alive(k)?.v ?? null }
  async setex(k: string, ttl: number, v: string) { this.kv.set(k, { v, exp: Date.now() + ttl * 1000 }) }
  async hgetall(k: string) { return { ...(this.hashes.get(k) ?? {}) } }
  multi() {
    const ops: Array<() => void> = []
    const chain = {
      incr: (k: string) => { ops.push(() => { const e = this.alive(k); this.kv.set(k, { v: String(parseInt(e?.v ?? '0', 10) + 1), exp: e?.exp ?? null }) }); return chain },
      incrbyfloat: (k: string, n: number) => { ops.push(() => { const e = this.alive(k); this.kv.set(k, { v: String(parseFloat(e?.v ?? '0') + n), exp: e?.exp ?? null }) }); return chain },
      expire: (k: string, ttl: number) => { ops.push(() => { const e = this.alive(k); if (e) e.exp = Date.now() + ttl * 1000 }); return chain },
      hincrby: (k: string, f: string, n: number) => { ops.push(() => { const h = this.hashes.get(k) ?? {}; h[f] = String(parseInt(h[f] ?? '0', 10) + n); this.hashes.set(k, h) }); return chain },
      exec: async () => { for (const op of ops) op(); return [] },
    }
    return chain
  }
}

export interface BudgetLimits {
  /** Calls per UTC day across all users (0 = unlimited). */
  globalDailyCalls: number
  /** Calls per UTC day per user (0 = unlimited). */
  userDailyCalls: number
  /** USD per UTC day across all users (0 = unlimited). */
  globalDailyUsd: number
}

export function limitsFromEnv(env = process.env): BudgetLimits {
  return {
    globalDailyCalls: parseInt(env.LLM_DAILY_CALL_CAP ?? '2000', 10),
    userDailyCalls: parseInt(env.LLM_USER_DAILY_CALL_CAP ?? '300', 10),
    globalDailyUsd: parseFloat(env.LLM_DAILY_USD_CAP ?? '20'),
  }
}

function day(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Redis-backed daily budget (extends the pre-v3 `llm:calls:<date>` counter). */
export class LlmBudget {
  constructor(private redis: BudgetStore | Redis, private limits: BudgetLimits = limitsFromEnv()) {}

  async check(userId?: string | null): Promise<void> {
    const d = day()
    const [g, u, usd] = await Promise.all([
      this.redis.get(`llm:calls:${d}`),
      userId ? this.redis.get(`llm:user:${userId}:calls:${d}`) : null,
      this.redis.get(`llm:usd:${d}`),
    ])
    if (this.limits.globalDailyCalls > 0 && parseInt(g ?? '0', 10) >= this.limits.globalDailyCalls) throw new LlmError('Daily LLM call budget exhausted', 'budget')
    if (userId && this.limits.userDailyCalls > 0 && parseInt(u ?? '0', 10) >= this.limits.userDailyCalls) throw new LlmError('Your daily AI budget is exhausted — try again tomorrow', 'budget')
    if (this.limits.globalDailyUsd > 0 && parseFloat(usd ?? '0') >= this.limits.globalDailyUsd) throw new LlmError('Daily LLM spend cap reached', 'budget')
  }

  async record(userId: string | null | undefined, usage: LlmUsage, costUsd: number, purpose: string): Promise<void> {
    const d = day()
    const ttl = 2 * 86400
    const m = this.redis.multi()
    m.incr(`llm:calls:${d}`).expire(`llm:calls:${d}`, ttl)
    m.incrbyfloat(`llm:usd:${d}`, costUsd).expire(`llm:usd:${d}`, ttl)
    m.hincrby(`llm:purpose:${d}`, purpose, 1).expire(`llm:purpose:${d}`, ttl)
    m.hincrby(`llm:tokens:${d}`, 'input', usage.inputTokens).hincrby(`llm:tokens:${d}`, 'output', usage.outputTokens).expire(`llm:tokens:${d}`, ttl)
    if (userId) m.incr(`llm:user:${userId}:calls:${d}`).expire(`llm:user:${userId}:calls:${d}`, ttl)
    await m.exec()
  }

  async today(): Promise<{ calls: number; usd: number; byPurpose: Record<string, number> }> {
    const d = day()
    const [calls, usd, byPurpose] = await Promise.all([this.redis.get(`llm:calls:${d}`), this.redis.get(`llm:usd:${d}`), this.redis.hgetall(`llm:purpose:${d}`)])
    return { calls: parseInt(calls ?? '0', 10), usd: parseFloat(usd ?? '0'), byPurpose: Object.fromEntries(Object.entries(byPurpose ?? {}).map(([k, v]) => [k, parseInt(v, 10)])) }
  }
}

export interface BudgetedOptions {
  /** Response cache (GH-11): identical (model, system, user, schema) → cached JSON for `cacheTtlSec`. 0 = off. */
  cacheTtlSec?: number
  cacheStore?: Pick<BudgetStore, 'get' | 'setex'> | null
}

/**
 * Decorator: enforce + meter a budget around any provider, record metrics, and (optionally) cache responses.
 * Cache keys are hashes of the full prompt, so PII never appears in Redis keys; values are the model's JSON.
 */
export class BudgetedProvider implements LlmProvider {
  readonly name: string
  private readonly cacheTtl: number
  private readonly cache: Pick<BudgetStore, 'get' | 'setex'> | null
  constructor(private inner: LlmProvider, private budget: LlmBudget, opts: BudgetedOptions = {}) {
    this.name = `${inner.name}+budget`
    this.cacheTtl = opts.cacheTtlSec ?? parseInt(process.env.LLM_CACHE_TTL_SEC ?? '604800', 10)
    this.cache = opts.cacheStore ?? null
  }
  private cacheKey<T>(req: JsonRequest<T>): string {
    return `llm:cache:${createHash('sha256').update([this.inner.name, req.purpose, req.schemaName ?? '', req.system, req.user, String(req.temperature ?? '')].join('\u0000')).digest('hex')}`
  }
  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const key = this.cache && this.cacheTtl > 0 ? this.cacheKey(req) : null
    if (key) {
      const hit = await this.cache!.get(key).catch(() => null)
      if (hit) {
        try {
          const cached = JSON.parse(hit) as JsonResult<unknown>
          m.llmCalls.inc({ provider: this.inner.name, purpose: req.purpose, outcome: 'cache_hit' })
          return { ...cached, data: req.schema.parse(cached.data), durationMs: 0, costUsd: 0 } as JsonResult<T>
        } catch { /* stale/invalid cache entry — fall through */ }
      }
    }
    await this.budget.check(req.userId)
    const t0 = Date.now()
    try {
      const r = await this.inner.completeJson(req)
      await this.budget.record(req.userId, r.usage, r.costUsd, req.purpose)
      m.llmCalls.inc({ provider: this.inner.name, purpose: req.purpose, outcome: 'ok' })
      m.llmDuration.observe({ provider: this.inner.name, purpose: req.purpose }, (Date.now() - t0) / 1000)
      m.llmCostUsd.inc({ provider: this.inner.name }, r.costUsd)
      m.llmTokens.inc({ provider: this.inner.name, direction: 'input' }, r.usage.inputTokens)
      m.llmTokens.inc({ provider: this.inner.name, direction: 'output' }, r.usage.outputTokens)
      if (key && this.cache!.setex) await this.cache!.setex(key, this.cacheTtl, JSON.stringify(r)).catch(() => undefined)
      return r
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'error'
      m.llmCalls.inc({ provider: this.inner.name, purpose: req.purpose, outcome: code })
      m.llmDuration.observe({ provider: this.inner.name, purpose: req.purpose }, (Date.now() - t0) / 1000)
      if (code !== 'budget') log.warn('llm call failed', { provider: this.inner.name, purpose: req.purpose, code, reason: (err as Error).message })
      throw err
    }
  }
}
