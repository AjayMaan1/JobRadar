import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface HimalayasJob {
  id: string
  title: string
  company: { name: string }
  applyUrl: string
  applicationUrl: string
  description: string
  publishedAt: string
  salary?: string
  locationRestrictions?: string[]
  skills: string[]
}

interface HimalayasResponse {
  jobs: HimalayasJob[]
}

export class HimalayasAdapter extends BaseAdapter {
  readonly sourceName = 'Himalayas'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const res = await this.fetchWithRetry(config.apiUrl!)
    const data = await res.json() as HimalayasResponse

    return this.filterRelevantJobs(data.jobs.map((job): RawJob => ({
      title: job.title,
      company: job.company?.name ?? 'Unknown',
      applyUrl: job.applicationUrl ?? job.applyUrl,
      sourceUrl: job.applyUrl,
      description: job.description,
      postedAt: job.publishedAt,
      salary: job.salary,
      location: job.locationRestrictions?.join(', '),
      tags: job.skills ?? [],
      sourceFingerprint: `himalayas-${job.id}`,
      sourceName: this.sourceName,
    })))
  }
}
