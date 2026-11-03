import { Worker } from 'bullmq'
import { enricher, semantic } from '../context.js'
import { connection, embedQueue } from '../queues.js'
import type { EnrichPayload } from '@jobradar/watchlist'
import { log } from '@jobradar/log'

// 2-core default: 2. Raise on bigger boxes.
const ENRICH_CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY ?? '2')
const ELIGIBLE = new Set(['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'])

export function startEnrichWorker(): Worker {
  return new Worker(
    'enrich',
    async (job) => {
      const p = job.data as EnrichPayload
      const r = await enricher.enrich(p)
      if (r.status === 'created') log.info(`[enrich] NEW ${r.opportunityClass} · ${p.raw.title} @ ${p.raw.company} · alert=${r.alert}`)
      // C13: embed eligible jobs off the hot path (dedupe by jobId; the embed worker upserts by text hash)
      if (semantic && r.jobId && r.opportunityClass && ELIGIBLE.has(r.opportunityClass) && (r.status === 'created' || r.status === 'updated')) {
        await embedQueue.add('job', { type: 'job', jobId: r.jobId }, { jobId: `embed--job--${r.jobId}`, removeOnComplete: 50, removeOnFail: 50, attempts: 3 }).catch(() => undefined)
      }
      return r
    },
    { connection, concurrency: ENRICH_CONCURRENCY }
  )
}
