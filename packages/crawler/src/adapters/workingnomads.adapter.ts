import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface WorkingNomadsJob {
  title: string
  company_name: string
  url: string
  description: string
  pub_date: string
  location: string
  tags: string | string[]
}

export class WorkingNomadsAdapter extends BaseAdapter {
  readonly sourceName = 'Working Nomads'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const res = await this.fetchWithRetry(config.apiUrl!, {
      headers: { Accept: 'application/json' },
    })
    
    // The API returns an array of jobs directly
    const data = await res.json() as WorkingNomadsJob[]

    return this.filterRelevantJobs((data || []).map((job): RawJob => ({
      title: job.title,
      company: job.company_name,
      applyUrl: job.url,
      sourceUrl: job.url,
      description: job.description,
      postedAt: job.pub_date,
      location: job.location,
      tags: typeof job.tags === 'string' ? job.tags.split(',') : (Array.isArray(job.tags) ? job.tags : []),
      sourceFingerprint: `workingnomads-${Buffer.from(job.url).toString('base64').substring(0, 32)}`,
      sourceName: this.sourceName,
    })))
  }
}
