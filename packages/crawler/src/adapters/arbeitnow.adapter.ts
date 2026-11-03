import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface ArbeitnowJob {
  slug: string
  company_name: string
  title: string
  description: string
  remote: boolean
  url: string
  tags: string[]
  job_types: string[]
  location: string
  created_at: number
}

interface ArbeitnowResponse {
  data: ArbeitnowJob[]
  links: { next?: string }
}

export class ArbeitnowAdapter extends BaseAdapter {
  readonly sourceName = 'Arbeitnow'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const jobs: RawJob[] = []
    let url: string | undefined = `${config.apiUrl}?page=1`

    while (url) {
      const res = await this.fetchWithRetry(url)
      const data = await res.json() as ArbeitnowResponse

      for (const job of data.data) {
        if (!job.remote) continue
        jobs.push({
          title: job.title,
          company: job.company_name,
          applyUrl: job.url,
          sourceUrl: job.url,
          description: job.description,
          postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : undefined,
          location: job.location || undefined,
          tags: job.tags,
          sourceFingerprint: `arbeitnow-${job.slug}`,
          sourceName: this.sourceName,
        })
      }

      url = data.links.next ?? undefined
      if (jobs.length >= 100) break
    }

    return this.filterRelevantJobs(jobs)
  }
}
