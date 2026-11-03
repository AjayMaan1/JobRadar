import 'dotenv/config'
import { prisma } from '@jobradar/db'
import { crawler, boards, enricher, sightings, dispatcher, resolver, prober } from './context.js'
import type { EnrichPayload } from '@jobradar/watchlist'
import { log } from '@jobradar/log'

/**
 * Direct run without BullMQ (still needs Postgres + Redis for the gateway's throttles).
 *   pnpm crawl            → aggregator sources + due boards
 *   pnpm crawl -- boards  → only due boards
 *   pnpm crawl -- resolve → resolve pending discoveries + probe new boards
 */
async function run() {
  const mode = process.argv[2] ?? 'all'
  const enrichAll = async (list: EnrichPayload[]) => {
    for (const e of list) {
      const r = await enricher.enrich(e)
      if (r.status === 'created') log.info(`  NEW [${r.opportunityClass}] ${e.raw.title} @ ${e.raw.company} (alert=${r.alert})`)
    }
  }

  if (mode === 'resolve') {
    log.info('Resolving pending discoveries...')
    log.info(await resolver.resolvePending(200))
    const ids = await prober.pendingBoards(50)
    for (const id of ids) {
      const r = await prober.probeBoard(id)
      log.info(`probe ${id}: ${r.outcome} (${r.enrich.length})`)
      await enrichAll(r.enrich)
    }
    process.exit(0)
  }

  if (mode === 'all') {
    const sources = await crawler.getRunnableSources()
    for (const source of sources) {
      log.info(`\n[${source.name}] fetching...`)
      try {
        const result = await crawler.crawlSource(source.id)
        if (result.error || result.unchanged) { log.info(`  ${result.error ?? 'unchanged'}`); continue }
        const feedKey = `source:${source.id}`
        const r = await sightings.reconcile({
          feedKey, sourceId: source.id, fullList: false,
          items: result.jobs.map((j) => ({ externalId: j.sourceFingerprint, hashFields: { t: j.title, c: j.company, u: j.applyUrl }, postedAt: j.postedAt ?? null })),
        })
        const byId = new Map(result.jobs.map((j) => [j.sourceFingerprint, j]))
        await enrichAll(r.newIds.map((id) => ({ feedKey, sourceId: source.id, externalId: id, raw: byId.get(id)!, event: 'new' as const })))
        log.info(`  ${result.jobs.length} items, ${r.newIds.length} new`)
      } catch (err) {
        log.error(`  failed: ${(err as Error).message}`)
      }
    }
  }

  log.info('\nPolling due boards...')
  const due = await dispatcher.claimDue(100)
  for (const id of due) {
    const r = await boards.poll(id, 'list')
    log.info(`board ${id.slice(0, 8)}: ${r.outcome} +${r.newCount}`)
    await enrichAll(r.enrich)
  }
  await prisma.$disconnect()
  process.exit(0)
}

run().catch((err) => {
  log.error('Direct crawl failed:', err)
  process.exit(1)
})
