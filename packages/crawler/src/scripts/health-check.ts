import { RemotiveAdapter } from '../adapters/remotive.adapter.js'
import { ArbeitnowAdapter } from '../adapters/arbeitnow.adapter.js'
import { HimalayasAdapter } from '../adapters/himalayas.adapter.js'
import { RemoteOKAdapter } from '../adapters/remoteok.adapter.js'
import { WeWorkRemotelyAdapter } from '../adapters/weworkremotely.adapter.js'
import { EverJobsAdapter } from '../adapters/everjobs.adapter.js'
import { UplersAdapter } from '../adapters/uplers.adapter.js'
import { NoDeskAdapter } from '../adapters/nodesk.adapter.js'
import { WorkingNomadsAdapter } from '../adapters/workingnomads.adapter.js'
import { EURemoteJobsAdapter } from '../adapters/euremotejobs.adapter.js'
import { ArcAdapter } from '../adapters/arc.adapter.js'
import { YCJobsAdapter } from '../adapters/yc-jobs.adapter.js'
import { WellfoundAdapter } from '../adapters/wellfound.adapter.js'
import type { BaseAdapter } from '../adapters/base.adapter.js'
import type { SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

const adapters: Array<{ adapter: BaseAdapter; config: Partial<SourceConfig> }> = [
  {
    adapter: new RemotiveAdapter(),
    config: { apiUrl: 'https://remotive.com/api/remote-jobs' },
  },
  {
    adapter: new ArbeitnowAdapter(),
    config: { apiUrl: 'https://www.arbeitnow.com/api/job-board-api' },
  },
  {
    adapter: new HimalayasAdapter(),
    config: { apiUrl: 'https://himalayas.app/jobs/api' },
  },
  {
    adapter: new RemoteOKAdapter(),
    config: { apiUrl: 'https://remoteok.io/api' },
  },
  {
    adapter: new WeWorkRemotelyAdapter(),
    config: {},
  },
  {
    adapter: new WorkingNomadsAdapter(),
    config: { apiUrl: 'https://www.workingnomads.com/api/exposed_jobs/?category=development' },
  },
  {
    adapter: new EURemoteJobsAdapter(),
    config: { apiUrl: 'https://euremotejobs.com/feed/' },
  },
  {
    adapter: new EverJobsAdapter(),
    config: {},
  },
  {
    adapter: new UplersAdapter(),
    config: {},
  },
  {
    adapter: new NoDeskAdapter(),
    config: { careersUrl: 'https://nodesk.co/remote-jobs/' },
  },
  {
    adapter: new ArcAdapter(),
    config: { careersUrl: 'https://arc.dev/remote-jobs' },
  },
  {
    adapter: new YCJobsAdapter(),
    config: { careersUrl: 'https://www.ycombinator.com/jobs?remote=true' },
  },
  {
    adapter: new WellfoundAdapter(),
    config: { careersUrl: 'https://wellfound.com/jobs?remote=true&role=engineer' },
  },
]

function mockConfig(partial: Partial<SourceConfig>): SourceConfig {
  return {
    id: 'health-check',
    name: 'health-check',
    domain: 'health-check',
    ingestionMethod: 'api',
    rateDelayMs: 1000,
    refreshIntervalHours: 8,
    qualityScore: 0,
    ...partial,
  }
}

async function run() {
  log.info('JobRadar Adapter Health Check\n' + '='.repeat(50))

  const results: Array<{ name: string; count: number; sample: string; status: string }> = []

  for (const { adapter, config } of adapters) {
    const name = adapter.sourceName
    process.stdout.write(`Checking ${name}... `)

    const start = Date.now()
    try {
      const availabilityIssue = adapter.availabilityIssue(mockConfig(config))
      if (availabilityIssue) {
        log.info(`WARN — 0ms`)
        log.info(`  Skipped: ${availabilityIssue}`)
        results.push({ name, count: 0, sample: '', status: 'WARN' })
        continue
      }

      const jobs = await adapter.fetch(mockConfig(config))
      const elapsed = Date.now() - start
      const count = jobs.length
      const sample = jobs[0] ? `"${jobs[0].title}" @ ${jobs[0].company}` : '(none)'
      const status = count > 0 ? 'OK' : 'WARN'
      log.info(`${status} — ${count} jobs in ${elapsed}ms`)
      if (count > 0) log.info(`  Sample: ${sample}`)
      results.push({ name, count, sample, status })
    } catch (err) {
      const elapsed = Date.now() - start
      log.info(`FAIL — ${elapsed}ms`)
      log.info(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      results.push({ name, count: 0, sample: '', status: 'FAIL' })
    }
  }

  log.info('\n' + '='.repeat(50))
  log.info('Summary:')
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗'
    log.info(`  ${icon} ${r.name.padEnd(30)} ${r.count} jobs`)
  }

  const failed = results.filter((r) => r.status === 'FAIL').length
  const warned = results.filter((r) => r.status === 'WARN').length
  log.info(`\n${results.length} adapters — ${results.length - failed - warned} OK, ${warned} warn, ${failed} failed`)

  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  log.error('Health check crashed:', err)
  process.exit(1)
})
