/**
 * Standalone fetch script — no DB/Redis needed.
 * Calls adapters directly and prints jobs posted in last N hours.
 */
import { RemotiveAdapter } from '../adapters/remotive.adapter.js'
import { ArbeitnowAdapter } from '../adapters/arbeitnow.adapter.js'
import { HimalayasAdapter } from '../adapters/himalayas.adapter.js'
import { RemoteOKAdapter } from '../adapters/remoteok.adapter.js'
import { WeWorkRemotelyAdapter } from '../adapters/weworkremotely.adapter.js'
import { WorkingNomadsAdapter } from '../adapters/workingnomads.adapter.js'
import { EURemoteJobsAdapter } from '../adapters/euremotejobs.adapter.js'
import { GenericRSSAdapter } from '../adapters/generic-rss.adapter.js'
import type { BaseAdapter } from '../adapters/base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

const HOURS = parseInt(process.env.HOURS ?? '6', 10)
const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000)

const sources: Array<{ adapter: BaseAdapter; config: Partial<SourceConfig> }> = [
  { adapter: new RemotiveAdapter(),       config: { apiUrl: 'https://remotive.io/api/remote-jobs' } },
  { adapter: new ArbeitnowAdapter(),      config: { apiUrl: 'https://www.arbeitnow.com/api/job-board-api' } },
  { adapter: new HimalayasAdapter(),      config: { apiUrl: 'https://himalayas.app/jobs/api' } },
  { adapter: new RemoteOKAdapter(),       config: { apiUrl: 'https://remoteok.io/api' } },
  { adapter: new WeWorkRemotelyAdapter(), config: {} },
  { adapter: new WorkingNomadsAdapter(),  config: { apiUrl: 'https://www.workingnomads.com/api/exposed_jobs/?category=development' } },
  { adapter: new EURemoteJobsAdapter(),   config: { apiUrl: 'https://euremotejobs.com/feed/' } },
  { adapter: new GenericRSSAdapter('Jobicy', 'https://jobicy.com/?feed=job_feed&job_types=full-time&search_keywords=engineer', 'Worldwide'), config: {} },
  { adapter: new GenericRSSAdapter('Remotive RSS', 'https://remotive.io/remote-jobs/feed/software-dev', 'Worldwide'), config: {} },
  { adapter: new GenericRSSAdapter('Himalayas RSS', 'https://himalayas.app/jobs/rss', 'Worldwide'), config: {} },
]

function mockConfig(partial: Partial<SourceConfig>): SourceConfig {
  return {
    id: 'fetch-recent',
    name: 'fetch-recent',
    domain: 'fetch-recent',
    ingestionMethod: 'api',
    rateDelayMs: 800,
    refreshIntervalHours: 6,
    qualityScore: 0,
    ...partial,
  }
}

function isRecent(postedAt?: string): boolean {
  if (!postedAt) return false
  const d = new Date(postedAt)
  return !isNaN(d.getTime()) && d >= cutoff
}

async function run() {
  log.info(`Fetching jobs posted in last ${HOURS}h (since ${cutoff.toISOString()})\n`)

  const allRecent: Array<RawJob & { source: string }> = []
  const stats: Array<{ name: string; total: number; recent: number; status: string }> = []

  for (const { adapter, config } of sources) {
    const name = adapter.sourceName
    process.stdout.write(`  ${name}... `)
    try {
      const jobs = await adapter.fetch(mockConfig(config))
      const recent = jobs.filter((j) => isRecent(j.postedAt))
      log.info(`${jobs.length} total, ${recent.length} recent`)
      recent.forEach((j) => allRecent.push({ ...j, source: name }))
      stats.push({ name, total: jobs.length, recent: recent.length, status: jobs.length > 0 ? 'OK' : 'WARN' })
    } catch (err) {
      log.info(`FAIL — ${err instanceof Error ? err.message : String(err)}`)
      stats.push({ name, total: 0, recent: 0, status: 'FAIL' })
    }
  }

  log.info('\n' + '='.repeat(70))
  log.info(`RECENT JOBS (last ${HOURS}h) — ${allRecent.length} total\n`)

  if (allRecent.length === 0) {
    log.info('No jobs with parseable timestamps found in this window.')
    log.info('Note: some sources (RemoteOK, Himalayas) include timestamps; others may not.\n')
    log.info('Showing ALL jobs from sources that returned data:\n')

    // Fallback: show first 5 from each working source
    for (const { adapter, config } of sources) {
      try {
        const jobs = await adapter.fetch(mockConfig(config))
        if (jobs.length > 0) {
          log.info(`\n--- ${adapter.sourceName} (${jobs.length} jobs) ---`)
          jobs.slice(0, 5).forEach((j) => {
            log.info(`  [${j.postedAt ?? 'no date'}] ${j.title} @ ${j.company}`)
            log.info(`    ${j.applyUrl}`)
          })
        }
      } catch { /* already logged above */ }
    }
  } else {
    // Sort by date desc
    allRecent.sort((a, b) => new Date(b.postedAt!).getTime() - new Date(a.postedAt!).getTime())
    allRecent.forEach((j) => {
      log.info(`[${j.postedAt}] ${j.title} @ ${j.company} (${j.source})`)
      log.info(`  Location: ${j.location ?? 'unspecified'} | Tags: ${(j.tags ?? []).slice(0, 4).join(', ')}`)
      log.info(`  ${j.applyUrl}\n`)
    })
  }

  log.info('\n' + '='.repeat(70))
  log.info('Source summary:')
  for (const s of stats) {
    const icon = s.status === 'OK' ? '✓' : s.status === 'WARN' ? '⚠' : '✗'
    log.info(`  ${icon} ${s.name.padEnd(28)} ${s.total} total, ${s.recent} recent`)
  }
}

run().catch((err) => {
  log.error('Fetch failed:', err)
  process.exit(1)
})
