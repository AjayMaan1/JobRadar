import { describe, it, expect } from 'vitest'
import { createLogger, configureLog, redact, type LogRecord } from './logger.js'
import { Registry } from './metrics.js'
import { withTimeout, TimeoutError } from './timeout.js'

describe('logger', () => {
  it('redacts sensitive keys at any depth and serialises errors', () => {
    const out = redact({ jobId: 'j1', content: { basics: { name: 'X' } }, nested: { password: 'p', list: [{ token: 't', ok: 1 }] }, err: new Error('boom') }) as Record<string, unknown>
    expect(out.jobId).toBe('j1')
    expect(out.content).toBe('[redacted]')
    expect((out.nested as Record<string, unknown>).password).toBe('[redacted]')
    expect(((out.nested as Record<string, unknown>).list as Array<Record<string, unknown>>)[0].token).toBe('[redacted]')
    expect(((out.nested as Record<string, unknown>).list as Array<Record<string, unknown>>)[0].ok).toBe(1)
    expect((out.err as Record<string, unknown>).message).toBe('boom')
  })
  it('emits console-compatible calls as structured records with bindings', () => {
    const recs: LogRecord[] = []
    configureLog({ level: 'debug', format: 'json', sink: (r) => recs.push(r) })
    const l = createLogger({ app: 'test' }).child({ queue: 'q1' })
    l.warn('something', { taskId: 't1', description: 'secret jd' }, new Error('e1'))
    l.debug('dbg')
    configureLog({ sink: null })
    expect(recs).toHaveLength(2)
    expect(recs[0].level).toBe('warn')
    expect(recs[0].msg).toBe('something')
    expect(recs[0].app).toBe('test')
    expect(recs[0].queue).toBe('q1')
    expect(recs[0].taskId).toBe('t1')
    expect(recs[0].description).toBe('[redacted]')
    expect((recs[0].err as Record<string, unknown>).message).toBe('e1')
  })
  it('respects the level threshold', () => {
    const recs: LogRecord[] = []
    configureLog({ level: 'warn', format: 'json', sink: (r) => recs.push(r) })
    const l = createLogger()
    l.info('hidden'); l.error('shown')
    configureLog({ sink: null, level: 'info' })
    expect(recs.map((r) => r.msg)).toEqual(['shown'])
  })
})

describe('metrics', () => {
  it('exposes counters, gauges and histograms in Prometheus text format', async () => {
    const r = new Registry()
    r.counter('c_total', 'c').inc({ route: '/api/x', status: 200 }, 2)
    r.gauge('g', 'g').set({ q: 'a' }, 3)
    r.histogram('h_seconds', 'h', [1, 5]).observe({ q: 'a' }, 2)
    const text = await r.expose()
    expect(text).toContain('# TYPE c_total counter')
    expect(text).toContain('c_total{route="/api/x",status="200"} 2')
    expect(text).toContain('g{q="a"} 3')
    expect(text).toContain('h_seconds_bucket{le="1",q="a"} 0')
    expect(text).toContain('h_seconds_bucket{le="5",q="a"} 1')
    expect(text).toContain('h_seconds_bucket{le="+Inf",q="a"} 1')
    expect(text).toContain('h_seconds_count{q="a"} 1')
    expect(text).toContain('process_resident_memory_bytes')
  })
  it('gauge collectors run on scrape', async () => {
    const r = new Registry()
    let n = 0
    const g = r.gauge('depth', 'd').collect(() => { g.set({ q: 'x' }, ++n) })
    await r.expose(); const t = await r.expose()
    expect(t).toContain('depth{q="x"} 2')
  })
})

describe('withTimeout', () => {
  it('resolves and clears the timer (no dangling rejection)', async () => {
    const before = process.listenerCount('unhandledRejection')
    let leaked = false
    const h = () => { leaked = true }
    process.on('unhandledRejection', h)
    const v = await withTimeout(Promise.resolve(1), 20)
    await new Promise((r) => setTimeout(r, 40))
    process.off('unhandledRejection', h)
    expect(v).toBe(1)
    expect(leaked).toBe(false)
    expect(process.listenerCount('unhandledRejection')).toBe(before)
  })
  it('rejects with TimeoutError when exceeded', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'x')).rejects.toBeInstanceOf(TimeoutError)
  })
})
