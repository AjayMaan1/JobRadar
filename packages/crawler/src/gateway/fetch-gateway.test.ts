import { describe, expect, it, beforeEach } from 'vitest'
import { FetchGateway } from './fetch-gateway.js'
import { createFakePrisma } from '../../../../tools/testkit/fake-prisma.js'
import { FakeRedis } from '../../../../tools/testkit/fake-redis.js'
import { FakeFetch } from '../../../../tools/testkit/fake-fetch.js'

let prisma: any, redis: FakeRedis, http: FakeFetch, gw: FetchGateway

beforeEach(async () => {
  prisma = createFakePrisma()
  redis = new FakeRedis()
  http = new FakeFetch().install()
  gw = new FetchGateway(prisma, redis as any)
  await prisma.hostPolicy.create({ data: { host: 'api.example', minIntervalMs: 50, burst: 2, maxConcurrency: 2, dailyBudget: 5, probeBudgetPerDay: 1 } })
  await prisma.hostPolicy.create({ data: { host: '*.html', minIntervalMs: 50, burst: 1, maxConcurrency: 1, dailyBudget: 100, probeBudgetPerDay: 0 } })
  await prisma.hostPolicy.create({ data: { host: '*', minIntervalMs: 50, burst: 1, maxConcurrency: 1, dailyBudget: 100, probeBudgetPerDay: 1 } })
  http.route(/\/robots\.txt$/, { status: 200, body: 'User-agent: *\nDisallow: /private\n' })
})

describe('FetchGateway classification', () => {
  it('200 JSON → changed with etag/hash; same hash next time → unchanged; 304 → unchanged', async () => {
    http.route('https://api.example/list', (req) => (req.headers['if-none-match'] === '"v1"' ? { status: 304, headers: { etag: '"v1"' } } : { status: 200, headers: { etag: '"v1"' }, body: { a: 1 } }))
    const a = await gw.fetch({ url: 'https://api.example/list', purpose: 'list' })
    expect(a.outcome).toBe('changed')
    expect(a.etag).toBe('"v1"')
    const b = await gw.fetch({ url: 'https://api.example/list', purpose: 'list', bodyHash: a.bodyHash })
    expect(b.outcome).toBe('unchanged')
    const c = await gw.fetch({ url: 'https://api.example/list', purpose: 'list', etag: '"v1"' })
    expect(c.outcome).toBe('unchanged')
    expect(c.body).toBeNull()
  })

  it('404 → not_found, 5xx → error, 403 → blocked (circuit opens 6h), challenge HTML on 200 → blocked', async () => {
    http.route('https://api.example/404', { status: 404, body: 'x' })
    http.route('https://api.example/500', { status: 500, body: 'x' })
    http.route('https://api.example/403', { status: 403, body: 'x' })
    expect((await gw.fetch({ url: 'https://api.example/404', purpose: 'list' })).outcome).toBe('not_found')
    expect((await gw.fetch({ url: 'https://api.example/500', purpose: 'list' })).outcome).toBe('error')
    expect((await gw.fetch({ url: 'https://api.example/403', purpose: 'list' })).outcome).toBe('blocked')
    const hp = await prisma.hostPolicy.findUnique({ where: { host: 'api.example' } })
    expect(hp.circuitState).toBe('open')
    expect(hp.circuitOpenUntil.getTime() - Date.now()).toBeGreaterThan(5 * 3600_000)
    // circuit open → skipped, nothing sent
    const n = http.requests.length
    expect((await gw.fetch({ url: 'https://api.example/404', purpose: 'list' })).outcome).toBe('skipped')
    expect(http.requests.length).toBe(n)
  })

  it('challenge page served with 200 to an API call is classified as blocked', async () => {
    http.route('https://other.example/api', { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><html><title>Just a moment...</title><script>cf-chl</script></html>' })
    expect((await gw.fetch({ url: 'https://other.example/api', purpose: 'list' })).outcome).toBe('blocked')
  })

  it('429 honours Retry-After and opens the circuit; half-open probe closes it on success', async () => {
    let mode: 'limit' | 'ok' = 'limit'
    http.route('https://api.example/r', () => (mode === 'limit' ? { status: 429, headers: { 'retry-after': '1' }, body: '' } : { status: 200, body: { ok: 1 } }))
    const r = await gw.fetch({ url: 'https://api.example/r', purpose: 'list' })
    expect(r.outcome).toBe('rate_limited')
    expect(r.retryAfterMs).toBe(1000)
    let hp = await prisma.hostPolicy.findUnique({ where: { host: 'api.example' } })
    expect(hp.circuitState).toBe('open')
    expect(hp.circuitOpenUntil.getTime() - Date.now()).toBeGreaterThan(30_000) // min 60s floor
    // simulate time passing
    await prisma.hostPolicy.update({ where: { host: 'api.example' }, data: { circuitOpenUntil: new Date(Date.now() - 1) } })
    mode = 'ok'
    expect((await gw.fetch({ url: 'https://api.example/r', purpose: 'list' })).outcome).toBe('changed')
    hp = await prisma.hostPolicy.findUnique({ where: { host: 'api.example' } })
    expect(hp.circuitState).toBe('closed')
  })
})

describe('FetchGateway politeness', () => {
  it('sends the JobRadar UA and conditional headers', async () => {
    http.route('https://api.example/h', { status: 200, body: { ok: 1 } })
    await gw.fetch({ url: 'https://api.example/h', purpose: 'list', etag: '"e"', lastModified: 'Mon' })
    const r = http.requests.at(-1)!
    expect(r.headers['user-agent']).toMatch(/^JobRadar\/2\.0/)
    expect(r.headers['if-none-match']).toBe('"e"')
    expect(r.headers['if-modified-since']).toBe('Mon')
  })

  it('enforces the daily budget and the probe budget', async () => {
    http.route('https://api.example/b', { status: 200, body: { ok: 1 } })
    const outcomes: string[] = []
    for (let i = 0; i < 6; i++) outcomes.push((await gw.fetch({ url: 'https://api.example/b', purpose: 'list' })).outcome)
    expect(outcomes.filter((o) => o === 'changed').length).toBe(5)
    expect(outcomes.at(-1)).toBe('skipped')
    const p1 = await gw.fetch({ url: 'https://api.example/b', purpose: 'probe' })
    expect(p1.outcome).toBe('skipped') // daily budget already exhausted
  })

  it('probe budget is independent of the list budget', async () => {
    http.route('https://fresh.example/b', { status: 200, body: { ok: 1 } })
    expect((await gw.fetch({ url: 'https://fresh.example/b', purpose: 'probe' })).outcome).toBe('changed')
    expect((await gw.fetch({ url: 'https://fresh.example/b', purpose: 'probe' })).outcome).toBe('skipped')
    expect((await gw.fetch({ url: 'https://fresh.example/b', purpose: 'list' })).outcome).toBe('changed')
  })

  it('respects robots.txt for HTML fetches only', async () => {
    http.route('https://site.example/private/x', { status: 200, body: '<html>secret</html>' })
    expect((await gw.fetch({ url: 'https://site.example/private/x', purpose: 'discovery', kind: 'html' })).outcome).toBe('skipped')
    expect((await gw.fetch({ url: 'https://site.example/private/x', purpose: 'discovery', kind: 'api' })).outcome).toBe('changed')
  })

  it('host kill switch stops all traffic immediately', async () => {
    await prisma.hostPolicy.update({ where: { host: 'api.example' }, data: { enabled: false } })
    gw.policyResolver.invalidate()
    const n = http.requests.length
    expect((await gw.fetch({ url: 'https://api.example/x', purpose: 'list' })).outcome).toBe('skipped')
    expect(http.requests.length).toBe(n)
  })

  it('token bucket spaces requests by minIntervalMs after the burst', async () => {
    http.route('https://api.example/t', { status: 200, body: { ok: 1 } })
    const t0 = Date.now()
    for (let i = 0; i < 4; i++) await gw.fetch({ url: 'https://api.example/t', purpose: 'list' })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90) // burst 2 → 2 waits of ≥50ms
  })

  it('logs a fetch_run per request with outcome + host', async () => {
    http.route('https://api.example/l', { status: 200, body: { ok: 1 } })
    await gw.fetch({ url: 'https://api.example/l', purpose: 'list', boardId: 'b1' })
    const runs = await prisma.fetchRun.findMany({})
    expect(runs.length).toBe(1)
    expect(runs[0]).toMatchObject({ host: 'api.example', outcome: 'changed', httpStatus: 200, boardId: 'b1' })
  })
})
