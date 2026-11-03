import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface SmartRecruitersResponse {
  content: Array<{
    id: string;
    name: string;
    location: {
      city: string;
      region: string;
      country: string;
      remote: boolean;
    };
    department?: {
      label: string;
    };
    type?: {
      label: string;
    };
    releasedDate: string;
  }>;
}

export class SmartRecruitersAdapter extends BaseAdapter {
  readonly sourceName = 'SmartRecruiters'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    // Extract company identifier from URL (e.g., https://careers.smartrecruiters.com/BoschGroup)
    let companyId = config.companyId
    if (!companyId && config.careersUrl) {
       const url = new URL(config.careersUrl)
       const parts = url.pathname.split('/').filter(Boolean)
       companyId = parts[0]
    }
    
    if (!companyId) throw new Error('SmartRecruiters adapter requires a companyId or valid careersUrl')

    // The public API endpoint
    const apiUrl = `https://api.smartrecruiters.com/v1/companies/${companyId}/postings`

    const res = await this.fetchWithRetry(apiUrl, {
      headers: {
        'Accept': 'application/json'
      }
    })

    const data = await res.json() as SmartRecruitersResponse
    const jobs: RawJob[] = []

    for (const job of data.content || []) {
      const applyUrl = `https://jobs.smartrecruiters.com/${companyId}/${job.id}`
      const loc = [job.location.city, job.location.region, job.location.country].filter(Boolean).join(', ')
      const locationText = job.location.remote ? `${loc} (Remote)` : loc

      jobs.push({
        title: job.name,
        company: config.name,
        applyUrl: applyUrl,
        sourceUrl: applyUrl,
        description: '', // Requires separate API call for full HTML description
        postedAt: job.releasedDate,
        location: locationText,
        tags: [job.department?.label, job.type?.label].filter(Boolean) as string[],
        sourceFingerprint: `smartrecruiters-${job.id}`,
        sourceName: this.sourceName,
      })
    }

    return jobs
  }
}
