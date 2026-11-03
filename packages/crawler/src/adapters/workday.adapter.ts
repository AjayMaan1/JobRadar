import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface WorkdayJobResponse {
  jobPostings: Array<{
    title: string;
    externalPath: string;
    locationsText: string;
    postedOn: string;
    bulletFields?: string[];
  }>;
}

export class WorkdayAdapter extends BaseAdapter {
  readonly sourceName = 'Workday'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    // Expected URL format: https://{company}.wd1.myworkdayjobs.com/{tenant}
    const baseUrl = config.careersUrl?.replace(/\/$/, '')
    if (!baseUrl) throw new Error('Workday adapter requires a careersUrl')

    const url = new URL(baseUrl)
    // Extract subdomain as tenant (e.g. nvidia from nvidia.wd5.myworkdayjobs.com)
    const subdomain = url.hostname.split('.')[0]
    
    // Extract external site path (e.g. from /External or /NVIDIAExternalCareerSite)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const externalSite = pathParts[0] || 'External'

    // The predictable API endpoint for Workday JSON
    const apiUrl = `${url.origin}/wday/cxs/${subdomain}/${externalSite}/jobs`

    const res = await this.fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({})
    })

    const data = await res.json() as WorkdayJobResponse
    const jobs: RawJob[] = []

    for (const job of data.jobPostings || []) {
      const applyUrl = `${baseUrl}${job.externalPath}`
      
      jobs.push({
        title: job.title,
        company: config.name,
        applyUrl: applyUrl,
        sourceUrl: applyUrl,
        description: '', // Workday requires a second API call per job to get description, skipping for summary list
        postedAt: job.postedOn,
        location: job.locationsText,
        tags: job.bulletFields || [],
        sourceFingerprint: `workday-${job.externalPath}`,
        sourceName: this.sourceName,
      })
    }

    return jobs
  }
}
