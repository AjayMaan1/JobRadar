import { Worker } from 'bullmq'
import { prisma, crawler, sightings } from '../context.js'
import { connection, enrichQueue, crawlQueue } from '../queues.js'
import type { EnrichPayload } from '@jobradar/watchlist'
import { log } from '@jobradar/log'

const CRAWL_CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY ?? '3')

/**
 * Aggregator sources (windowed feeds). Fetch → result-hash short-circuit → reconcile sightings
 * (no closures for windowed feeds) → enqueue enrich for NEW items only.
 */
export function startCrawlWorker(): Worker {
  return new Worker(
    'crawl',
    async (job) => {
      if (job.data.type === 'all') {
        // Manual "refresh": enqueue every runnable source once (deduped by jobId).
        const sources = await crawler.getRunnableSources()
        for (const s of sources) {
          await crawlQueue.add('crawl-source', { type: 'source', sourceId: s.id }, { jobId: `manual--${s.id}--${Math.floor(Date.now() / 600_000)}` })
        }
        return { enqueued: sources.length }
      }
      if (job.data.type !== 'source') return
      const { sourceId } = job.data as { sourceId: string }
      const source = await prisma.source.findUnique({ where: { id: sourceId } })
      if (!source || !source.enabled) return { skipped: 'missing/disabled' }

      const result = await crawler.crawlSource(sourceId)
      if (result.error) return { skipped: result.error }
      if (result.unchanged) {
        log.info(`[${source.name}] unchanged (${result.jobs.length} items)`)
        return { unchanged: true }
      }

      const feedKey = `source:${source.id}`
      const items = result.jobs.map((r) => ({
        externalId: r.sourceFingerprint,
        hashFields: { title: r.title, company: r.company, url: r.applyUrl, posted: r.postedAt ?? null },
        postedAt: r.postedAt ?? null,
      }))
      const r = await sightings.reconcile({ feedKey, sourceId: source.id, items, fullList: false })
      const byId = new Map(result.jobs.map((j) => [j.sourceFingerprint, j]))
      let enqueued = 0
      for (const id of [...r.newIds, ...r.reappearedIds]) {
        const raw = byId.get(id)
        if (!raw) continue
        const payload: EnrichPayload = { feedKey, sourceId: source.id, externalId: id, raw, event: r.newIds.includes(id) ? 'new' : 'reappeared' }
        await enrichQueue.add('enrich', payload, { jobId: `enrich--${feedKey.replace(/:/g, '_')}--${id.replace(/:/g, '_')}`.slice(0, 200) })
        enqueued++
      }
      log.info(`[${source.name}] ${result.jobs.length} items · ${r.newIds.length} new · ${enqueued} enqueued`)
      return { items: result.jobs.length, new: r.newIds.length }
    },
    { connection, concurrency: CRAWL_CONCURRENCY }
  )
}
