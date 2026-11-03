import * as cheerio from 'cheerio'
import type { RawJob, SourceConfig } from '../types.js'
import { BaseAdapter } from './base.adapter.js'

interface YCJobPosting {
  id: number
  title: string
  url: string
  location?: string | null
  type?: string | null
  role?: string | null
  roleSpecificType?: string | null
  prettyRole?: string | null
  salaryRange?: string | null
  equityRange?: string | null
  minExperience?: string | null
  visa?: string | null
  skills?: string[]
  companyName?: string | null
  companyOneLiner?: string | null
}

export class YCJobsAdapter extends BaseAdapter {
  readonly sourceName = 'Y Combinator Jobs'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const url = config.careersUrl ?? 'https://www.ycombinator.com/jobs?remote=true'
    const res = await this.fetchWithRetry(url, { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const $ = cheerio.load(html)
    const rawPageData =
      $('div[id^="WaasLandingPage-react-component"]').attr('data-page') ??
      $('div[data-page*="jobPostings"]').attr('data-page')

    if (!rawPageData) {
      throw new Error('YC jobs page payload missing data-page attribute')
    }

    const page = JSON.parse(rawPageData) as { props?: { jobPostings?: YCJobPosting[] } }
    const jobs = (page.props?.jobPostings ?? []).map((job) => this.mapJob(job))

    return jobs.filter((job) => {
      if (!this.isRelevantRole(job.title, job.tags ?? [], job.description)) return false

      const remoteText = `${job.location ?? ''} ${job.description} ${(job.tags ?? []).join(' ')}`
      if (!/\bremote\b/i.test(remoteText)) return false
      if (this.isExplicitlyCountryRestricted(remoteText) && !this.hasPreferredRemoteSignals(remoteText)) {
        return false
      }

      return this.hasPreferredRemoteSignals(remoteText) || !/remote \([^)]+\)/i.test(remoteText)
    })
  }

  private mapJob(job: YCJobPosting): RawJob {
    const publicUrl = `https://www.workatastartup.com${job.url}`

    return {
      title: job.title,
      company: job.companyName?.trim() || 'YC startup',
      applyUrl: publicUrl,
      sourceUrl: publicUrl,
      description: this.joinMetadataLines([
        job.companyOneLiner ?? null,
        job.type ? `Job type: ${job.type}` : null,
        job.prettyRole ? `Role: ${job.prettyRole}` : null,
        job.roleSpecificType ? `Track: ${job.roleSpecificType}` : null,
        job.location ? `Location: ${job.location}` : null,
        job.visa ? `Visa / work authorization: ${job.visa}` : null,
        job.minExperience ? `Experience: ${job.minExperience}` : null,
        job.salaryRange ? `Salary: ${job.salaryRange}` : null,
        job.equityRange ? `Equity: ${job.equityRange}` : null,
        job.skills?.length ? `Skills: ${job.skills.join(', ')}` : null,
      ]),
      salary: job.salaryRange || undefined,
      location: job.location || 'Remote',
      tags: [
        job.type ?? undefined,
        job.prettyRole ?? undefined,
        job.roleSpecificType ?? undefined,
        ...(job.skills ?? []),
      ].filter(Boolean) as string[],
      sourceFingerprint: `yc-${job.id}`,
      sourceName: this.sourceName,
    }
  }
}
