import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  category: string
  tags: string[]
  job_type: string
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
  company_logo_url: string
}

interface RemotiveResponse {
  jobs: RemotiveJob[]
}

export class RemotiveAdapter extends BaseAdapter {
  readonly sourceName = 'Remotive'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const apiUrl = (config.apiUrl ?? 'https://remotive.com/api/remote-jobs').replace(
      'remotive.io',
      'remotive.com'
    )
    const res = await this.fetchWithRetry(apiUrl)
    const data = await res.json() as RemotiveResponse

    return this.filterRelevantJobs(data.jobs.map((job): RawJob => ({
      title: job.title,
      company: job.company_name,
      applyUrl: job.url,
      sourceUrl: job.url,
      description: job.description,
      postedAt: job.publication_date,
      salary: job.salary || undefined,
      location: job.candidate_required_location || undefined,
      tags: job.tags,
      sourceFingerprint: `remotive-${job.id}`,
      sourceName: this.sourceName,
    })))
  }
}
