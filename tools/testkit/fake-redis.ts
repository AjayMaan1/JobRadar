/** Minimal ioredis double: string ops + the two Lua scripts used by the gateway throttle. */
export class FakeRedis {
  private kv = new Map<string, { v: string; exp: number | null }>()
  private hashes = new Map<string, Record<string, string>>()
  public now: () => number = () => Date.now()

  private alive(key: string) {
    const e = this.kv.get(key)
    if (e && e.exp !== null && e.exp <= this.now()) { this.kv.delete(key); return undefined }
    return e
  }
  async get(key: string) { return this.alive(key)?.v ?? null }
  async set(key: string, v: string | number, ...args: Array<string | number>) {
    // SET key value [EX seconds] [NX]
    const a = args.map(String)
    const nx = a.includes('NX')
    const exIdx = a.indexOf('EX')
    const ttl = exIdx >= 0 ? Number(a[exIdx + 1]) : null
    if (nx && this.alive(key)) return null
    this.kv.set(key, { v: String(v), exp: ttl ? this.now() + ttl * 1000 : null })
    return 'OK'
  }
  async setex(key: string, ttl: number, v: string | number) { this.kv.set(key, { v: String(v), exp: this.now() + ttl * 1000 }); return 'OK' }
  async incr(key: string) { const n = parseInt(this.alive(key)?.v ?? '0', 10) + 1; this.kv.set(key, { v: String(n), exp: this.alive(key)?.exp ?? null }); return n }
  async decr(key: string) { const n = parseInt(this.alive(key)?.v ?? '0', 10) - 1; this.kv.set(key, { v: String(n), exp: this.alive(key)?.exp ?? null }); return n }
  async expire(key: string, ttl: number) { const e = this.alive(key); if (e) e.exp = this.now() + ttl * 1000; return e ? 1 : 0 }
  async del(key: string) { return this.kv.delete(key) ? 1 : 0 }
  async incrbyfloat(key: string, by: number) { const n = parseFloat(this.alive(key)?.v ?? '0') + Number(by); this.kv.set(key, { v: String(n), exp: this.alive(key)?.exp ?? null }); return String(n) }
  async hincrby(key: string, field: string, by: number) { const h = this.hashes.get(key) ?? {}; h[field] = String(parseInt(h[field] ?? '0', 10) + Number(by)); this.hashes.set(key, h); return parseInt(h[field], 10) }
  async hget(key: string, field: string) { return this.hashes.get(key)?.[field] ?? null }
  async hset(key: string, field: string, v: string | number) { const h = this.hashes.get(key) ?? {}; h[field] = String(v); this.hashes.set(key, h); return 1 }
  async hgetall(key: string) { return { ...(this.hashes.get(key) ?? {}) } }
  async keys(pattern: string) { const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return [...this.kv.keys(), ...this.hashes.keys()].filter((k) => re.test(k)) }
  /** Chained multi(): queues calls, exec() runs them in order (no atomicity needed for tests). */
  multi() {
    const ops: Array<() => Promise<unknown>> = []
    const self = this
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'exec') return async () => { const out: Array<[null, unknown]> = []; for (const op of ops) out.push([null, await op()]); return out }
        return (...args: any[]) => { ops.push(() => (self as any)[prop](...args)); return chain }
      },
    })
    return chain
  }
  disconnect() {}
  async quit() { return 'OK' }
  async ping() { return 'PONG' }
  async connect() {}
  on(_ev: string, _fn: (...a: any[]) => void) { return this }
  duplicate() { return this }
  status = 'ready'
  async exists(...keys: string[]) { return keys.filter((k) => this.alive(k) || this.hashes.has(k)).length }
  async ttl(key: string) { const e = this.alive(key); return e ? (e.exp === null ? -1 : Math.ceil((e.exp - this.now()) / 1000)) : -2 }
  async incrby(key: string, by: number) { const n = parseInt(this.alive(key)?.v ?? '0', 10) + Number(by); this.kv.set(key, { v: String(n), exp: this.alive(key)?.exp ?? null }); return n }
  // pub/sub (single process): subscribers receive publishes synchronously
  private subs = new Map<string, Array<(ch: string, msg: string) => void>>()
  async publish(ch: string, msg: string) { const fns = this.subs.get(ch) ?? []; for (const f of fns) f(ch, msg); return fns.length }
  async subscribe(...chs: string[]) { for (const ch of chs) this.subs.set(ch, this.subs.get(ch) ?? []); return chs.length }
  async unsubscribe(...chs: string[]) { for (const ch of chs) this.subs.delete(ch); return chs.length }
  onMessage(fn: (ch: string, msg: string) => void) { for (const [ch, arr] of this.subs) arr.push(fn) }

  async eval(script: string, _numKeys: number, key: string, ...args: any[]) {
    if (script.includes("'tokens', 'ts'")) {
      const [nowArg, capArg, intervalArg] = args.map(Number)
      const h = this.hashes.get(key) ?? {}
      let tokens = h.tokens !== undefined ? Number(h.tokens) : capArg
      let ts = h.ts !== undefined ? Number(h.ts) : nowArg
      const refill = Math.floor((nowArg - ts) / intervalArg)
      if (refill > 0) { tokens = Math.min(capArg, tokens + refill); ts = ts + refill * intervalArg }
      if (tokens >= 1) { tokens -= 1; this.hashes.set(key, { tokens: String(tokens), ts: String(ts) }); return 0 }
      this.hashes.set(key, { tokens: String(tokens), ts: String(ts) })
      return ts + intervalArg - nowArg
    }
    if (script.includes('INCR')) {
      const max = Number(args[0])
      const cur = parseInt(this.alive(key)?.v ?? '0', 10)
      if (cur >= max) return 0
      await this.incr(key)
      return 1
    }
    throw new Error('FakeRedis: unknown script')
  }
}
