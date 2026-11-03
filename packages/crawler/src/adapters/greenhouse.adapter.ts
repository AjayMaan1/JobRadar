import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

interface GreenhouseJob {
  id: number
  title: string
  location: { name: string }
  updated_at: string
  absolute_url: string
  content?: string
  metadata?: Array<{ name: string; value: string | null }>
  departments?: Array<{ name: string }>
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[]
}

// Curated list of companies with EMEA/UAE/Remote roles on Greenhouse
const GREENHOUSE_COMPANIES = [
  'remote',         // Remote.com
  'gitlab',
  'cloudflare',
  'hashicorp',
  'grafana',
  'mongodb',
  'elastic',
  'confluent',
  'datadog',
  'figma',
]

export class GreenhouseAdapter extends BaseAdapter {
  readonly sourceName = 'Greenhouse ATS'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const jobs: RawJob[] = []

    for (const slug of GREENHOUSE_COMPANIES) {
      try {
        const res = await this.fetchWithRetry(
          `${config.apiUrl}/${slug}/jobs?content=true`,
          {},
          2
        )
        const data = await res.json() as GreenhouseResponse

        for (const job of data.jobs) {
          const location = job.location?.name?.toLowerCase() ?? ''
          const isRemote =
            location.includes('remote') ||
            location.includes('anywhere') ||
            location.includes('worldwide') ||
            location === ''

          if (!isRemote) continue

          jobs.push({
            title: job.title,
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            applyUrl: job.absolute_url,
            sourceUrl: job.absolute_url,
            description: job.content ?? '',
            postedAt: job.updated_at,
            location: job.location?.name,
            tags: job.departments?.map((d) => d.name) ?? [],
            sourceFingerprint: `greenhouse-${job.id}`,
            sourceName: this.sourceName,
          })
        }

        await new Promise((r) => setTimeout(r, 500))
      } catch (err) {
        log.warn(`Greenhouse: failed to fetch ${slug}:`, err)
      }
    }

    return this.filterRelevantJobs(jobs)
  }
}
