import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import type { PrismaClient } from '@jobradar/db'
import { BaseAdapter } from './adapters/base.adapter.js'
import { FetchGateway } from './gateway/index.js'
import { adapterForSource, availabilityIssueForSource, toSourceConfig, type SourceLike } from './source-registry.js'
import type { RawJob } from './types.js'
import { log } from '@jobradar/log'

export interface CrawlResult {
  jobs: RawJob[]
  /** true when the adapter output is byte-identical to the previous crawl (skip processing). */
  unchanged: boolean
  error?: string
}

/**
 * Aggregator crawls (the legacy `sources` table). No result cache: every scheduled crawl hits
 * the network through the gateway; result-level hashing makes unchanged crawls cheap downstream.
 */
export class CrawlerService {
  readonly gateway: FetchGateway

  constructor(
    private redis: Redis,
    private prisma: PrismaClient,
    gateway?: FetchGateway
  ) {
    this.gateway = gateway ?? new FetchGateway(prisma, redis)
    BaseAdapter.gateway = this.gateway
  }

  public getAdapterForSource(source: SourceLike): BaseAdapter | undefined {
    return adapterForSource(source)
  }

  public getAvailabilityIssueForSource(source: SourceLike): string | null {
    return availabilityIssueForSource(source)
  }

  async crawlSource(sourceId: string): Promise<CrawlResult> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } })
    if (!source || !source.enabled) return { jobs: [], unchanged: false, error: 'source missing or disabled' }
    if (source.backoffUntil && source.backoffUntil.getTime() > Date.now()) {
      return { jobs: [], unchanged: false, error: `backing off until ${source.backoffUntil.toISOString()}` }
    }

    const adapter = this.getAdapterForSource(source)
    if (!adapter) {
      log.warn(`No adapter for domain: ${source.domain} (source: ${source.name})`)
      return { jobs: [], unchanged: false, error: 'no adapter' }
    }
    const config = toSourceConfig(source)
    const availabilityIssue = adapter.availabilityIssue(config)
    if (availabilityIssue) return { jobs: [], unchanged: false, error: availabilityIssue }

    BaseAdapter.context = { sourceId }
    try {
      const jobs = await adapter.fetch(config)
      const hash = createHash('sha256')
        .update(JSON.stringify(jobs.map((j) => [j.sourceFingerprint, j.title, j.company, j.applyUrl, j.postedAt ?? ''])))
        .digest('hex')
      const unchanged = source.bodyHash === hash
      await this.prisma.source.update({
        where: { id: sourceId },
        data: { lastCrawledAt: new Date(), failureCount: 0, bodyHash: hash, backoffUntil: null },
      })
      return { jobs, unchanged }
    } catch (err) {
      const failures = source.failureCount + 1
      const backoffMin = Math.min(2 ** failures, 360)
      log.error(`Crawl failed for ${source.name} (failure #${failures}, backoff ${backoffMin}m):`, (err as Error).message)
      await this.prisma.source.update({
        where: { id: sourceId },
        data: { failureCount: { increment: 1 }, backoffUntil: new Date(Date.now() + backoffMin * 60_000) },
      })
      throw err
    } finally {
      BaseAdapter.context = {}
    }
  }

  async getAllEnabledSources() {
    return this.prisma.source.findMany({ where: { enabled: true } })
  }

  async getRunnableSources() {
    const sources = await this.getAllEnabledSources()
    return sources.filter((source) => !this.getAvailabilityIssueForSource(source))
  }
}
