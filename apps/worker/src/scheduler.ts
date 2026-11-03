import { prisma } from '@jobradar/db'
import { availabilityIssueForSource } from '@jobradar/crawler'
import { crawlQueue, discoveryQueue, embedQueue, maintenanceQueue, notifyQueue } from './queues.js'
import { log } from '@jobradar/log'

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * Per-source schedulers for the legacy aggregator sources (one repeatable job per source, interval
 * from sources.refresh_interval_hours). Re-synced hourly so enabling/disabling a source in the DB
 * takes effect without a restart.
 */
export async function syncSourceSchedules(): Promise<{ scheduled: number; removed: number }> {
  const sources = await prisma.source.findMany()
  const existing = await crawlQueue.getJobSchedulers(0, 10_000)
  const wanted = new Map<string, { every: number; sourceId: string }>()
  for (const s of sources) {
    const issue = availabilityIssueForSource(s)
    if ((s.availabilityIssue ?? null) !== issue) {
      await prisma.source.update({ where: { id: s.id }, data: { availabilityIssue: issue } })
    }
    if (!s.enabled) continue
    if (issue) continue
    const hours = Math.max(0.25, s.refreshIntervalHours || 8)
    wanted.set(`crawl:${s.id}`, { every: Math.round(hours * HOUR), sourceId: s.id })
  }
  let removed = 0
  for (const sch of existing) {
    if (!sch.key) continue
    if (sch.key.startsWith('crawl:') && !wanted.has(sch.key)) {
      await crawlQueue.removeJobScheduler(sch.key)
      removed++
    }
  }
  let scheduled = 0
  for (const [key, w] of wanted) {
    // jitter the phase so sources with the same interval don't fire together
    const phase = Math.floor(Math.random() * Math.min(w.every, 15 * MIN))
    await crawlQueue.upsertJobScheduler(
      key,
      { every: w.every, startDate: new Date(Date.now() + phase) },
      { name: 'crawl-source', data: { type: 'source', sourceId: w.sourceId }, opts: { removeOnComplete: 50, removeOnFail: 100 } }
    )
    scheduled++
  }
  return { scheduled, removed }
}

export async function setupSchedules(): Promise<void> {
  // Hot path: dispatcher claims due boards every 30s
  await maintenanceQueue.upsertJobScheduler('dispatch', { every: 30_000 }, { name: 'dispatch', data: { type: 'dispatch' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Probe newly resolved boards (budgeted) every 5 min
  await maintenanceQueue.upsertJobScheduler('probe-sweep', { every: 5 * MIN }, { name: 'probe-sweep', data: { type: 'probe-sweep' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Resolve pending discoveries every 10 min
  await maintenanceQueue.upsertJobScheduler('resolve-sweep', { every: 10 * MIN }, { name: 'resolve-sweep', data: { type: 'resolve-sweep' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Tiering hourly
  await maintenanceQueue.upsertJobScheduler('tiering', { every: HOUR }, { name: 'tiering', data: { type: 'tiering' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Health/ops alerts every 5 min
  await maintenanceQueue.upsertJobScheduler('health', { every: 5 * MIN }, { name: 'health', data: { type: 'health' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Source schedule sync hourly
  await maintenanceQueue.upsertJobScheduler('sync-schedules', { every: HOUR }, { name: 'sync-schedules', data: { type: 'sync-schedules' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Liveness + retention daily (03:30 IST, off-peak)
  await maintenanceQueue.upsertJobScheduler('liveness', { pattern: '30 3 * * *', tz: 'Asia/Kolkata' }, { name: 'liveness', data: { type: 'liveness' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  await maintenanceQueue.upsertJobScheduler('retention', { pattern: '0 4 * * *', tz: 'Asia/Kolkata' }, { name: 'retention', data: { type: 'retention' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  // Follow-up reminders (GH-5) every morning at 09:00 IST
  await maintenanceQueue.upsertJobScheduler('follow-ups', { pattern: '0 9 * * *', tz: 'Asia/Kolkata' }, { name: 'follow-ups', data: { type: 'follow-ups' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })

  // C13: embed jobs that still lack vectors (new postings are embedded right after enrich; this catches up)
  await embedQueue.upsertJobScheduler('embed-backfill', { every: 15 * MIN }, { name: 'backfill', data: { type: 'backfill' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })

  // Discovery (slow path)
  await discoveryQueue.upsertJobScheduler('discover-hn', { pattern: '15 6 * * *', tz: 'Asia/Kolkata' }, { name: 'discover', data: { type: 'hn' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  await discoveryQueue.upsertJobScheduler('discover-github', { pattern: '30 6 * * 1', tz: 'Asia/Kolkata' }, { name: 'discover', data: { type: 'github' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  await discoveryQueue.upsertJobScheduler('discover-yc', { pattern: '45 6 * * 2', tz: 'Asia/Kolkata' }, { name: 'discover', data: { type: 'yc' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })
  await discoveryQueue.upsertJobScheduler('discover-funding', { pattern: '0 7 * * *', tz: 'Asia/Kolkata' }, { name: 'discover', data: { type: 'funding' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })

  // Digest: runs hourly; each recipient is served at their own digest hour/timezone (v5), legacy recipients at 08:00 IST
  await notifyQueue.upsertJobScheduler('daily-digest', { pattern: '0 * * * *', tz: 'UTC' }, { name: 'daily-digest', data: { type: 'digest' }, opts: { removeOnComplete: 5, removeOnFail: 20 } })

  const { scheduled, removed } = await syncSourceSchedules()
  log.info(`Schedules configured: dispatcher 30s · probe 5m · resolve 10m · tiering 1h · health 5m · liveness/retention daily · discovery daily/weekly · digest 08:00 IST · ${scheduled} source crawls (${removed} removed)`)
}
