import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import type { PrismaClient } from '@jobradar/db'
import { CRAWLER_CONFIG } from '../config.js'
import { HostPolicyResolver } from './host-policy.js'
import { HostThrottle, sleep } from './throttle.js'
import { RobotsCache } from './robots.js'
import type { GatewayRequest, GatewayResponse, GatewayOutcome } from './types.js'
import { assertPublicUrl, EgressBlockedError, readBodyCapped } from './egress.js'
import { log, m } from '@jobradar/log'

const CHALLENGE_MARKERS = [
  /cf-chl/i,
  /cf_chl_opt/i,
  /just a moment/i,
  /attention required!?\s*\|\s*cloudflare/i,
  /datadome/i,
  /_abck/i,
  /px-captcha/i,
  /perimeterx/i,
  /access denied/i,
  /are you a human/i,
  /verify you are human/i,
  /enable javascript and cookies to continue/i,
]

function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

function classify(status: number, body: string, contentType: string | null, expectJson: boolean): GatewayOutcome {
  if (status === 304) return 'unchanged'
  if (status === 429) return 'rate_limited'
  if (status === 404 || status === 410) return 'not_found'
  if (status === 403 || status === 401) return 'blocked'
  if (status === 503 || status === 202) {
    if (CHALLENGE_MARKERS.some((m) => m.test(body.slice(0, 20_000)))) return 'blocked'
    return 'error'
  }
  if (status >= 200 && status < 300) {
    const looksHtml = /text\/html/i.test(contentType ?? '') || /^\s*<!doctype html|^\s*<html/i.test(body.slice(0, 200))
    if (expectJson && looksHtml && CHALLENGE_MARKERS.some((m) => m.test(body.slice(0, 20_000)))) return 'blocked'
    return 'changed'
  }
  return 'error'
}

/**
 * Single egress point. Enforces host policy (rate, concurrency, budget), robots.txt for HTML,
 * conditional requests, response classification, circuit breakers and fetch_runs logging.
 * Adapters and engines must never call fetch() directly.
 */
export class FetchGateway {
  private policies: HostPolicyResolver
  private throttle: HostThrottle
  private robots: RobotsCache

  constructor(private prisma: PrismaClient, private redis: Redis) {
    this.policies = new HostPolicyResolver(prisma)
    this.throttle = new HostThrottle(redis, CRAWLER_CONFIG.globalMaxRps)
    this.robots = new RobotsCache(redis)
  }

  get policyResolver() {
    return this.policies
  }

  get hostThrottle() {
    return this.throttle
  }

  async fetch(req: GatewayRequest): Promise<GatewayResponse> {
    const started = Date.now()
    const url = new URL(req.url)
    const host = url.hostname
    const kind = req.kind ?? 'api'
    const base: Omit<GatewayResponse, 'outcome'> = {
      status: null,
      body: null,
      etag: null,
      lastModified: null,
      bodyHash: null,
      durationMs: 0,
      bytes: 0,
      host,
      contentType: null,
    }

    // Egress guard (audit NEW-27): never fetch internal/private addresses, whatever a feed or a page says.
    try {
      await assertPublicUrl(req.url)
    } catch (err) {
      if (err instanceof EgressBlockedError) return this.finish(req, { ...base, outcome: 'skipped', error: err.message }, started)
      throw err
    }

    const policy = await this.policies.resolve(host, kind)
    if (!policy.enabled) {
      return this.finish(req, { ...base, outcome: 'skipped', error: `host disabled: ${policy.host}` }, started)
    }

    // Circuit breaker (exact host)
    const circuit = await this.policies.circuitFor(host)
    if (circuit.state === 'open') {
      if (circuit.until && circuit.until.getTime() > Date.now()) {
        return this.finish(req, { ...base, outcome: 'skipped', error: `circuit open until ${circuit.until.toISOString()}`, retryAfterMs: circuit.until.getTime() - Date.now() }, started)
      }
      await this.policies.halfOpen(host)
    }

    // Probe budget (first-time fetches of a board)
    if (req.purpose === 'probe') {
      const ok = await this.throttle.consumeProbeBudget(policy.host === '*' ? host : policy.host, policy.probeBudgetPerDay)
      if (!ok) return this.finish(req, { ...base, outcome: 'skipped', error: 'probe budget exhausted' }, started)
    }

    // Daily budget
    const remaining = await this.throttle.consumeDailyBudget(host, policy.dailyBudget)
    if (remaining < 0) {
      return this.finish(req, { ...base, outcome: 'skipped', error: 'daily budget exhausted' }, started)
    }
    if (remaining === Math.floor(policy.dailyBudget * 0.2)) {
      log.warn(`[gateway] ${host}: 80% of daily budget (${policy.dailyBudget}) used`)
    }

    // robots.txt for HTML fetches
    if (kind === 'html' && policy.respectRobots && req.purpose !== 'robots') {
      const { allowed, crawlDelayMs } = await this.robots.isAllowed(req.url, (u) => this.rawText(u))
      if (!allowed) return this.finish(req, { ...base, outcome: 'skipped', error: 'disallowed by robots.txt' }, started)
      if (crawlDelayMs && crawlDelayMs > policy.minIntervalMs) await sleep(crawlDelayMs - policy.minIntervalMs)
    }

    // Concurrency + token bucket
    const slotAcquired = await this.waitForSlot(host, policy.maxConcurrency)
    if (!slotAcquired) return this.finish(req, { ...base, outcome: 'skipped', error: 'concurrency wait timeout' }, started)
    try {
      const token = await this.throttle.acquireToken(host, policy.minIntervalMs, policy.burst)
      if (!token) return this.finish(req, { ...base, outcome: 'skipped', error: 'rate wait timeout' }, started)

      const headers: Record<string, string> = {
        'User-Agent': CRAWLER_CONFIG.userAgent,
        Accept: kind === 'html' ? 'text/html,application/xhtml+xml,*/*;q=0.8' : 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(req.headers ?? {}),
      }
      if (req.etag) headers['If-None-Match'] = req.etag
      if (req.lastModified) headers['If-Modified-Since'] = req.lastModified

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? CRAWLER_CONFIG.defaultTimeoutMs)
      let res: Response
      try {
        // Redirects are followed manually so every hop goes through the egress guard (an open redirect on a
        // public careers site must not become a door to 127.0.0.1).
        let current = req.url
        let hops = 0
        for (;;) {
          res = await fetch(current, {
            method: req.method ?? 'GET',
            headers,
            body: req.body,
            signal: controller.signal,
            redirect: 'manual',
          })
          const location = res.headers.get('location')
          if (req.manualRedirect || res.status < 300 || res.status >= 400 || !location) break
          if (++hops > CRAWLER_CONFIG.maxRedirects) { clearTimeout(timer); return this.finish(req, { ...base, outcome: 'error', status: res.status, error: `too many redirects (${hops})` }, started) }
          current = new URL(location, current).toString()
          try { await assertPublicUrl(current) } catch (err) {
            clearTimeout(timer)
            return this.finish(req, { ...base, outcome: 'skipped', status: res.status, error: (err as Error).message }, started)
          }
          try { await res.body?.cancel() } catch { /* ignore */ }
        }
      } catch (err) {
        clearTimeout(timer)
        const isTimeout = (err as Error)?.name === 'AbortError'
        return this.finish(req, { ...base, outcome: isTimeout ? 'timeout' : 'error', error: String((err as Error)?.message ?? err) }, started)
      }

      const contentType = res.headers.get('content-type')
      let body = ''
      if (req.method !== 'HEAD') {
        const capped = await readBodyCapped(res, req.maxBodyBytes ?? CRAWLER_CONFIG.maxBodyBytes).catch((err: Error) => ({ text: '', truncated: false, err }))
        clearTimeout(timer)
        if ('err' in capped) return this.finish(req, { ...base, outcome: capped.err.name === 'AbortError' ? 'timeout' : 'error', error: capped.err.message }, started)
        if (capped.truncated) return this.finish(req, { ...base, outcome: 'error', status: res.status, contentType, error: `body exceeds ${req.maxBodyBytes ?? CRAWLER_CONFIG.maxBodyBytes} bytes` }, started)
        body = capped.text
      } else clearTimeout(timer)
      const status = res.status
      let outcome = classify(status, body, contentType, kind === 'api')

      if (req.manualRedirect && status >= 300 && status < 400) {
        return this.finish(req, { ...base, outcome: 'changed', status, body: '', redirectLocation: res.headers.get('location'), contentType }, started)
      }

      const bodyHash = body ? hashBody(body) : null
      if (outcome === 'changed' && req.bodyHash && bodyHash === req.bodyHash) outcome = 'unchanged'

      const retryAfter = res.headers.get('retry-after')
      let retryAfterMs: number | undefined
      if (retryAfter) {
        const n = parseInt(retryAfter, 10)
        retryAfterMs = !isNaN(n) ? n * 1000 : Math.max(0, new Date(retryAfter).getTime() - Date.now())
      }

      // Circuit handling
      if (outcome === 'rate_limited') {
        const ms = Math.min(Math.max(retryAfterMs ?? 0, CRAWLER_CONFIG.rateLimitCircuitMinMs) * (await this.tripMultiplier(host)), CRAWLER_CONFIG.rateLimitCircuitMaxMs)
        await this.policies.openCircuit(host, ms, `429 on ${req.url}`)
      } else if (outcome === 'blocked') {
        await this.policies.openCircuit(host, CRAWLER_CONFIG.blockCircuitMs, `blocked (${status}) on ${req.url}`)
        log.error(`[gateway] BLOCKED by ${host} (${status}) — circuit open 6h. Operator review required.`)
      } else if (outcome === 'changed' || outcome === 'unchanged' || outcome === 'not_found') {
        const c = await this.policies.circuitFor(host)
        if (c.state === 'half_open') await this.policies.closeCircuit(host)
      }

      return this.finish(
        req,
        {
          ...base,
          outcome,
          status,
          body: outcome === 'unchanged' ? null : body,
          etag: res.headers.get('etag'),
          lastModified: res.headers.get('last-modified'),
          bodyHash: outcome === 'unchanged' ? req.bodyHash ?? bodyHash : bodyHash,
          bytes: body.length,
          retryAfterMs,
          contentType,
          error: outcome === 'error' || outcome === 'blocked' || outcome === 'rate_limited' ? `HTTP ${status}` : undefined,
        },
        started
      )
    } finally {
      await this.throttle.releaseSlot(host)
    }
  }

  /** Convenience: JSON GET returning parsed body or null on unchanged/error. */
  async json<T>(req: GatewayRequest): Promise<{ res: GatewayResponse; data: T | null }> {
    const res = await this.fetch(req)
    if (res.outcome !== 'changed' || !res.body) return { res, data: null }
    try {
      return { res, data: JSON.parse(res.body) as T }
    } catch (err) {
      return { res: { ...res, outcome: 'error', error: `invalid JSON: ${String(err)}` }, data: null }
    }
  }

  private async waitForSlot(host: string, max: number): Promise<boolean> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (await this.throttle.acquireSlot(host, max)) return true
      await sleep(250 + Math.floor(Math.random() * 250))
    }
    return false
  }

  private async tripMultiplier(host: string): Promise<number> {
    const row = await this.prisma.hostPolicy.findUnique({ where: { host } })
    const trips = row?.tripCount7d ?? 0
    return Math.min(2 ** trips, 64)
  }

  /** Unthrottled, quiet text fetch used only for robots.txt. */
  private async rawText(url: string): Promise<string | null> {
    try {
      await assertPublicUrl(url)
      const res = await fetch(url, {
        headers: { 'User-Agent': CRAWLER_CONFIG.userAgent },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  private async finish(req: GatewayRequest, res: GatewayResponse, started: number): Promise<GatewayResponse> {
    res.durationMs = Date.now() - started
    m.fetchOutcomes.inc({ host: res.host, outcome: res.outcome, kind: req.kind ?? 'api' })
    if (!req.quiet && res.outcome !== 'skipped' && req.purpose !== 'robots') {
      const outcome = (res.outcome === 'not_found' ? 'error' : res.outcome) as 'unchanged' | 'changed' | 'error' | 'rate_limited' | 'blocked' | 'timeout'
      try {
        await this.prisma.fetchRun.create({
          data: {
            boardId: req.boardId ?? null,
            sourceId: req.sourceId ?? null,
            host: res.host,
            durationMs: res.durationMs,
            httpStatus: res.status,
            bytes: res.bytes,
            outcome,
            errorClass: res.outcome === 'changed' || res.outcome === 'unchanged' ? null : res.outcome,
            errorMessage: res.error?.slice(0, 500) ?? null,
          },
        })
      } catch (err) {
        log.warn('[gateway] failed to log fetch_run:', (err as Error).message)
      }
    }
    return res
  }
}
