/**
 * Minimal Prometheus-compatible metrics registry (audit NEW-06). Counters, gauges and histograms with labels,
 * text exposition at /metrics (web) and :9464/metrics (worker). No external dependency; ~150 lines.
 */
type Labels = Record<string, string | number>
const key = (labels: Labels) => Object.keys(labels).sort().map((k) => `${k}=${JSON.stringify(String(labels[k]))}`).join(',')
const fmtLabels = (labels: Labels, extra?: Labels) => {
  const all = { ...labels, ...(extra ?? {}) }
  const ks = Object.keys(all).sort()
  return ks.length ? `{${ks.map((k) => `${k}="${String(all[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',')}}` : ''
}

abstract class Metric {
  constructor(readonly name: string, readonly help: string, readonly type: 'counter' | 'gauge' | 'histogram') {}
  abstract expose(): string
}

export class Counter extends Metric {
  private values = new Map<string, { labels: Labels; value: number }>()
  constructor(name: string, help: string) { super(name, help, 'counter') }
  inc(labels: Labels = {}, by = 1): void {
    const k = key(labels)
    const cur = this.values.get(k) ?? { labels, value: 0 }
    cur.value += by
    this.values.set(k, cur)
  }
  get(labels: Labels = {}): number { return this.values.get(key(labels))?.value ?? 0 }
  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const v of this.values.values()) lines.push(`${this.name}${fmtLabels(v.labels)} ${v.value}`)
    if (this.values.size === 0) lines.push(`${this.name} 0`)
    return lines.join('\n')
  }
}

export class Gauge extends Metric {
  private values = new Map<string, { labels: Labels; value: number }>()
  private collectors: Array<() => Promise<void> | void> = []
  constructor(name: string, help: string) { super(name, help, 'gauge') }
  set(labels: Labels, value: number): void
  set(value: number): void
  set(a: Labels | number, b?: number): void {
    const labels = typeof a === 'number' ? {} : a
    const value = typeof a === 'number' ? a : (b as number)
    this.values.set(key(labels), { labels, value })
  }
  inc(labels: Labels = {}, by = 1): void { this.set(labels, (this.values.get(key(labels))?.value ?? 0) + by) }
  dec(labels: Labels = {}, by = 1): void { this.inc(labels, -by) }
  /** Async collector invoked on every scrape (queue depths etc.). */
  collect(fn: () => Promise<void> | void): this { this.collectors.push(fn); return this }
  async refresh(): Promise<void> { for (const c of this.collectors) { try { await c() } catch { /* scrape must not fail */ } } }
  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]
    for (const v of this.values.values()) lines.push(`${this.name}${fmtLabels(v.labels)} ${v.value}`)
    return lines.join('\n')
  }
}

export class Histogram extends Metric {
  private series = new Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>()
  constructor(name: string, help: string, readonly bounds: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]) { super(name, help, 'histogram') }
  observe(labels: Labels, value: number): void
  observe(value: number): void
  observe(a: Labels | number, b?: number): void {
    const labels = typeof a === 'number' ? {} : a
    const value = typeof a === 'number' ? a : (b as number)
    const k = key(labels)
    const s = this.series.get(k) ?? { labels, buckets: this.bounds.map(() => 0), sum: 0, count: 0 }
    this.bounds.forEach((bound, i) => { if (value <= bound) s.buckets[i]++ })
    s.sum += value
    s.count++
    this.series.set(k, s)
  }
  /** Time an async function (seconds). */
  async time<T>(labels: Labels, fn: () => Promise<T>): Promise<T> {
    const t0 = process.hrtime.bigint()
    try { return await fn() } finally { this.observe(labels, Number(process.hrtime.bigint() - t0) / 1e9) }
  }
  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    for (const s of this.series.values()) {
      this.bounds.forEach((bound, i) => lines.push(`${this.name}_bucket${fmtLabels(s.labels, { le: String(bound) })} ${s.buckets[i]}`))
      lines.push(`${this.name}_bucket${fmtLabels(s.labels, { le: '+Inf' })} ${s.count}`)
      lines.push(`${this.name}_sum${fmtLabels(s.labels)} ${s.sum}`)
      lines.push(`${this.name}_count${fmtLabels(s.labels)} ${s.count}`)
    }
    return lines.join('\n')
  }
}

export class Registry {
  private metrics = new Map<string, Metric>()
  counter(name: string, help: string): Counter { return this.get(name, () => new Counter(name, help)) as Counter }
  gauge(name: string, help: string): Gauge { return this.get(name, () => new Gauge(name, help)) as Gauge }
  histogram(name: string, help: string, bounds?: number[]): Histogram { return this.get(name, () => new Histogram(name, help, bounds)) as Histogram }
  private get(name: string, make: () => Metric): Metric {
    let m = this.metrics.get(name)
    if (!m) { m = make(); this.metrics.set(name, m) }
    return m
  }
  /** Prometheus text exposition format 0.0.4. */
  async expose(): Promise<string> {
    const out: string[] = []
    for (const m of this.metrics.values()) {
      if (m instanceof Gauge) await m.refresh()
      out.push(m.expose())
    }
    const mem = process.memoryUsage()
    out.push(`# HELP process_resident_memory_bytes Resident memory size in bytes.\n# TYPE process_resident_memory_bytes gauge\nprocess_resident_memory_bytes ${mem.rss}`)
    out.push(`# HELP process_heap_used_bytes V8 heap used.\n# TYPE process_heap_used_bytes gauge\nprocess_heap_used_bytes ${mem.heapUsed}`)
    out.push(`# HELP process_uptime_seconds Process uptime.\n# TYPE process_uptime_seconds gauge\nprocess_uptime_seconds ${Math.round(process.uptime())}`)
    return out.join('\n') + '\n'
  }
  reset(): void { this.metrics.clear() }
}

/** Process-wide registry (guarded on globalThis so Next.js dev re-evaluation keeps one instance). */
const g = globalThis as unknown as { __jobradarMetrics?: Registry }
export const metrics: Registry = (g.__jobradarMetrics ??= new Registry())

// ── Shared metric names (defined once so web and worker expose the same series) ───────────────────────────
// HTTP request counts/latency are deliberately NOT emitted here: Next.js route handlers have no request hook,
// and always-zero series mislead. Scrape them from the reverse proxy (Caddy/nginx) instead.
export const m = {
  logEvents: metrics.counter('jobradar_log_events_total', 'Log records by level'),
  queueJobs: metrics.counter('jobradar_queue_jobs_total', 'Queue jobs processed by queue and outcome'),
  queueDuration: metrics.histogram('jobradar_queue_job_seconds', 'Queue job duration'),
  queueDepth: metrics.gauge('jobradar_queue_depth', 'Queue depth by queue and state'),
  fetchOutcomes: metrics.counter('jobradar_fetch_total', 'Gateway fetches by host and outcome'),
  llmCalls: metrics.counter('jobradar_llm_calls_total', 'LLM calls by provider, purpose and outcome'),
  llmDuration: metrics.histogram('jobradar_llm_call_seconds', 'LLM call latency', [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300]),
  llmCostUsd: metrics.counter('jobradar_llm_cost_usd_total', 'LLM spend in USD'),
  llmTokens: metrics.counter('jobradar_llm_tokens_total', 'LLM tokens by direction'),
  renders: metrics.counter('jobradar_renders_total', 'Resume renders by renderer and outcome'),
  workerHeartbeat: metrics.gauge('jobradar_worker_heartbeat_timestamp_seconds', 'Last worker heartbeat (unix seconds)'),
  rateLimited: metrics.counter('jobradar_rate_limited_total', 'Requests rejected by rate limits'),
}
