import { Worker } from 'bullmq'
import { discoverFromHn, discoverFromGithubLists, discoverFromYc, discoverFromFundingFeeds } from '@jobradar/crawler'
import { discovery, gateway } from '../context.js'
import { connection } from '../queues.js'
import { log } from '@jobradar/log'

/** Slow path: fetch a discovery source and persist candidates (resolver picks them up later). */
export function startDiscoveryWorker(): Worker {
  return new Worker(
    'discovery',
    async (job) => {
      const { type } = job.data as { type: 'hn' | 'github' | 'yc' | 'funding' }
      const cands =
        type === 'hn' ? await discoverFromHn(gateway)
        : type === 'github' ? await discoverFromGithubLists(gateway)
        : type === 'yc' ? await discoverFromYc(gateway)
        : type === 'funding' ? await discoverFromFundingFeeds(gateway)
        : []
      const r = await discovery.recordMany(cands)
      log.info(`[discovery:${type}] ${r.seen} candidates · ${r.created} new`)
      return r
    },
    { connection, concurrency: 1 }
  )
}
