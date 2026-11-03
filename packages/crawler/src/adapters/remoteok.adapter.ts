import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

interface RemoteOKJob {
  id?: string
  slug?: string
  position?: string
  company?: string
  url?: string
  apply_url?: string
  description?: string
  date?: string
  salary_min?: number
  salary_max?: number
  tags?: string[]
  location?: string
}

export class RemoteOKAdapter extends BaseAdapter {
  readonly sourceName = 'Remote OK'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    // remoteok.io redirects to HTML (bot detection); remoteok.com/api works with curl-like UA
    const apiUrl = (config.apiUrl ?? 'https://remoteok.com/api').replace('remoteok.io', 'remoteok.com')
    const res = await this.fetchWithRetry(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'curl/7.85.0',
      },
    })
    const body = await res.text()
    const trimmed = body.trim()

    if (!trimmed.startsWith('[')) {
      log.warn('RemoteOKAdapter: expected JSON feed, received non-JSON response')
      return []
    }

    let raw: RemoteOKJob[]
    try {
      raw = JSON.parse(trimmed) as RemoteOKJob[]
    } catch (err) {
      log.warn('RemoteOKAdapter: failed to parse JSON feed', err)
      return []
    }

    // Index 0 is metadata, skip it
    const jobs = Array.isArray(raw) ? raw.slice(1) : []

    return this.filterRelevantJobs(jobs
      .filter((job) => job.slug && job.position && job.company)
      .map((job): RawJob => {
        const salary =
          job.salary_min && job.salary_max
            ? `$${job.salary_min}–$${job.salary_max}/yr`
            : undefined

        return {
          title: job.position!,
          company: job.company!,
          applyUrl: job.apply_url ?? job.url ?? `https://remoteok.io/l/${job.slug}`,
          sourceUrl: `https://remoteok.io/l/${job.slug}`,
          description: job.description ?? '',
          postedAt: job.date,
          salary,
          location: job.location,
          tags: job.tags ?? [],
          sourceFingerprint: `remoteok-${job.slug}`,
          sourceName: this.sourceName,
        }
      }))
  }
}
