import type Redis from 'ioredis'

/**
 * Redis-backed per-host throttle:
 *  - token bucket (capacity = burst, refill 1 token / minIntervalMs)
 *  - concurrency cap
 *  - daily request budget
 *  - global requests/sec cap
 * All checks are atomic Lua scripts so multiple workers share one view.
 */

// KEYS[1]=bucket key, ARGV[1]=now ms, ARGV[2]=capacity, ARGV[3]=refill interval ms
// returns wait ms (0 = token acquired)
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local interval = tonumber(ARGV[3])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = cap; ts = now end
local refill = math.floor((now - ts) / interval)
if refill > 0 then
  tokens = math.min(cap, tokens + refill)
  ts = ts + refill * interval
end
if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
  redis.call('PEXPIRE', key, interval * (cap + 2))
  return 0
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, interval * (cap + 2))
return (ts + interval) - now
`

// KEYS[1]=conc key, ARGV[1]=max, ARGV[2]=ttl ms   → 1 acquired / 0 rejected
const CONCURRENCY_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`

function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export class HostThrottle {
  constructor(private redis: Redis, private globalMaxRps: number) {}

  /** Blocks until a token is available (bounded by maxWaitMs). Returns false if it gave up. */
  async acquireToken(host: string, minIntervalMs: number, burst: number, maxWaitMs = 120_000): Promise<boolean> {
    const key = `gw:bucket:${host}`
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      const wait = (await this.redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        Date.now(),
        Math.max(1, burst),
        Math.max(50, minIntervalMs)
      )) as number
      const globalWait = await this.globalWait()
      const w = Math.max(wait, globalWait)
      if (w <= 0) return true
      if (Date.now() + w > deadline) return false
      await sleep(w + Math.floor(Math.random() * 100))
    }
  }

  private async globalWait(): Promise<number> {
    if (!this.globalMaxRps || this.globalMaxRps <= 0) return 0
    const key = 'gw:bucket:__global__'
    const wait = (await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      Date.now(),
      Math.ceil(this.globalMaxRps),
      Math.ceil(1000 / this.globalMaxRps)
    )) as number
    return wait
  }

  async acquireSlot(host: string, max: number, ttlMs = 60_000): Promise<boolean> {
    const key = `gw:conc:${host}`
    const ok = (await this.redis.eval(CONCURRENCY_LUA, 1, key, Math.max(1, max), ttlMs)) as number
    return ok === 1
  }

  async releaseSlot(host: string): Promise<void> {
    const key = `gw:conc:${host}`
    const v = await this.redis.decr(key)
    if (v < 0) await this.redis.set(key, 0)
  }

  /** Returns remaining budget after consuming one; -1 if exhausted (nothing consumed). */
  async consumeDailyBudget(host: string, budget: number): Promise<number> {
    const key = `gw:budget:${host}:${dayKey()}`
    const used = await this.redis.incr(key)
    if (used === 1) await this.redis.expire(key, 2 * 86400)
    if (used > budget) {
      await this.redis.decr(key)
      return -1
    }
    return budget - used
  }

  async consumeProbeBudget(host: string, budget: number): Promise<boolean> {
    if (budget <= 0) return false
    const key = `gw:probe:${host}:${dayKey()}`
    const used = await this.redis.incr(key)
    if (used === 1) await this.redis.expire(key, 2 * 86400)
    if (used > budget) {
      await this.redis.decr(key)
      return false
    }
    return true
  }

  async budgetUsed(host: string): Promise<number> {
    const v = await this.redis.get(`gw:budget:${host}:${dayKey()}`)
    return v ? parseInt(v, 10) : 0
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
