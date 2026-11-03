import type { PrismaClient } from '@jobradar/db'
import { CRAWLER_CONFIG } from '../config.js'

export interface ResolvedHostPolicy {
  id: string | null
  host: string // the policy row's host pattern that matched
  enabled: boolean
  maxConcurrency: number
  minIntervalMs: number
  burst: number
  dailyBudget: number
  probeBudgetPerDay: number
  respectRobots: boolean
  circuitState: 'closed' | 'open' | 'half_open'
  circuitOpenUntil: Date | null
}

const FALLBACK: ResolvedHostPolicy = {
  id: null,
  host: '*',
  enabled: true,
  maxConcurrency: 1,
  minIntervalMs: 3000,
  burst: 1,
  dailyBudget: 1000,
  probeBudgetPerDay: 50,
  respectRobots: true,
  circuitState: 'closed',
  circuitOpenUntil: null,
}

/**
 * Resolves the most specific host policy: exact host → wildcard suffix (*.example.com)
 * → '*.html' for HTML fetches → '*' default. Cached in memory for a short TTL.
 */
export class HostPolicyResolver {
  private cache = new Map<string, { at: number; policy: ResolvedHostPolicy }>()

  constructor(private prisma: PrismaClient) {}

  async resolve(host: string, kind: 'api' | 'html'): Promise<ResolvedHostPolicy> {
    const key = `${kind}:${host}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < CRAWLER_CONFIG.hostPolicyCacheSeconds * 1000) return hit.policy

    const candidates = [host]
    const parts = host.split('.')
    for (let i = 1; i < parts.length - 1; i++) candidates.push(`*.${parts.slice(i).join('.')}`)
    if (kind === 'html') candidates.push('*.html')
    candidates.push('*')

    const rows = await this.prisma.hostPolicy.findMany({ where: { host: { in: candidates } } })
    const byHost = new Map(rows.map((r) => [r.host, r]))
    let policy: ResolvedHostPolicy = FALLBACK
    for (const c of candidates) {
      const r = byHost.get(c)
      if (r) {
        policy = {
          id: r.id,
          host: r.host,
          enabled: r.enabled,
          maxConcurrency: r.maxConcurrency,
          minIntervalMs: r.minIntervalMs,
          burst: r.burst,
          dailyBudget: r.dailyBudget,
          probeBudgetPerDay: r.probeBudgetPerDay,
          respectRobots: r.respectRobots,
          circuitState: r.circuitState,
          circuitOpenUntil: r.circuitOpenUntil,
        }
        break
      }
    }
    this.cache.set(key, { at: Date.now(), policy })
    return policy
  }

  invalidate(host?: string) {
    if (!host) this.cache.clear()
    else for (const k of [...this.cache.keys()]) if (k.endsWith(`:${host}`)) this.cache.delete(k)
  }

  /** Circuit state is keyed by the *actual* host so one tenant doesn't trip a wildcard policy for all. */
  async openCircuit(host: string, ms: number, reason: string): Promise<void> {
    const until = new Date(Date.now() + ms)
    // A materialised exact-host row inherits the numbers of the policy that currently governs it
    // (wildcard or default) so tripping a circuit never loosens the rate limits.
    const inherited = await this.resolve(host, 'api')
    await this.prisma.hostPolicy.upsert({
      where: { host },
      update: {
        circuitState: 'open',
        circuitOpenUntil: until,
        circuitOpenedAt: new Date(),
        tripCount7d: { increment: 1 },
        notes: reason.slice(0, 500),
      },
      create: {
        host,
        circuitState: 'open',
        circuitOpenUntil: until,
        circuitOpenedAt: new Date(),
        tripCount7d: 1,
        notes: reason.slice(0, 500),
        maxConcurrency: inherited.maxConcurrency,
        minIntervalMs: inherited.minIntervalMs,
        burst: inherited.burst,
        dailyBudget: inherited.dailyBudget,
        probeBudgetPerDay: inherited.probeBudgetPerDay,
        respectRobots: inherited.respectRobots,
      },
    })
    this.invalidate(host)
  }

  async closeCircuit(host: string): Promise<void> {
    await this.prisma.hostPolicy.updateMany({
      where: { host },
      data: { circuitState: 'closed', circuitOpenUntil: null },
    })
    this.invalidate(host)
  }

  async halfOpen(host: string): Promise<void> {
    await this.prisma.hostPolicy.updateMany({ where: { host }, data: { circuitState: 'half_open' } })
    this.invalidate(host)
  }

  /** Exact-host circuit lookup (wildcard policy rows never carry circuit state for a specific host). */
  async circuitFor(host: string): Promise<{ state: 'closed' | 'open' | 'half_open'; until: Date | null }> {
    const row = await this.prisma.hostPolicy.findUnique({ where: { host } })
    if (!row) return { state: 'closed', until: null }
    return { state: row.circuitState, until: row.circuitOpenUntil }
  }
}
