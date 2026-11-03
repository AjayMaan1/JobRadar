import type { RawJob, SourceConfig } from '../types.js'
import { BaseAdapter } from './base.adapter.js'

interface ArcCategory {
  name?: string
}

interface ArcCompany {
  name?: string | null
}

interface ArcInternalJob {
  randomKey: string
  title: string
  jobType?: string | null
  jobRole?: string | null
  timeZone?: string | null
  clientTimeZoneRestriction?: string | null
  overlapHours?: number | null
  experienceLevel?: string | null
  requiredCountries?: string[]
  postedAt?: number
  urlString: string
  minAnnualSalary?: number | null
  maxAnnualSalary?: number | null
  minHourlyRate?: number | null
  maxHourlyRate?: number | null
  company?: ArcCompany | null
  categories?: ArcCategory[]
}

interface ArcExternalJob {
  randomKey: string
  title: string
  jobType?: string | null
  positionType?: string | null
  experienceLevels?: string[]
  requiredCountries?: string[]
  postedAt?: number
  urlString: string
  company?: ArcCompany | null
  categories?: ArcCategory[]
}

interface ArcPageProps {
  arcJobs?: ArcInternalJob[]
  externalJobs?: ArcExternalJob[]
}

export class ArcAdapter extends BaseAdapter {
  readonly sourceName = 'Arc.dev'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const url = config.careersUrl ?? 'https://arc.dev/remote-jobs'
    const res = await this.fetchWithRetry(url, { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const pageProps = this.parsePageProps(html)

    const jobs = [
      ...(pageProps.arcJobs ?? []).map((job) => this.mapInternalJob(job)),
      ...(pageProps.externalJobs ?? []).map((job) => this.mapExternalJob(job)),
    ]

    return jobs.filter((job) => {
      if (!this.isRelevantRole(job.title, job.tags ?? [], job.description)) return false

      const remoteText = `${job.location ?? ''} ${job.description} ${(job.tags ?? []).join(' ')}`
      if (this.isExplicitlyCountryRestricted(remoteText) && !this.hasPreferredRemoteSignals(remoteText)) {
        return false
      }

      return this.hasPreferredRemoteSignals(remoteText) || /\bremote\b/i.test(remoteText)
    })
  }

  private parsePageProps(html: string): ArcPageProps {
    const marker = '<script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">'
    const start = html.indexOf(marker)
    if (start === -1) {
      throw new Error('Arc.dev page payload missing __NEXT_DATA__')
    }

    const jsonStart = start + marker.length
    const jsonEnd = html.indexOf('</script>', jsonStart)
    const json = JSON.parse(html.slice(jsonStart, jsonEnd)) as { props?: { pageProps?: ArcPageProps } }
    return json.props?.pageProps ?? {}
  }

  private mapInternalJob(job: ArcInternalJob): RawJob {
    const coverage = this.summarizeCountryCodes(job.requiredCountries ?? [])
    const url = `https://arc.dev/remote-jobs/details/${job.urlString}-${job.randomKey}`

    return {
      title: job.title,
      company: job.company?.name?.trim() || 'Arc client',
      applyUrl: url,
      sourceUrl: url,
      description: this.joinMetadataLines([
        `Job type: ${this.normalizeJobType(job.jobType)}`,
        coverage.length > 0 ? `Eligible regions: ${coverage.join(', ')}` : null,
        job.requiredCountries?.length ? `Eligible country codes: ${job.requiredCountries.join(', ')}` : null,
        job.timeZone ? `Timezone: ${job.timeZone}` : null,
        job.clientTimeZoneRestriction ? `Timezone restriction: ${job.clientTimeZoneRestriction}` : null,
        job.overlapHours ? `Timezone overlap: ${job.overlapHours} hours` : null,
        job.experienceLevel ? `Experience level: ${job.experienceLevel}` : null,
        this.formatSalary(job.minAnnualSalary, job.maxAnnualSalary, job.minHourlyRate, job.maxHourlyRate),
      ]),
      postedAt: job.postedAt ? new Date(job.postedAt * 1000).toISOString() : undefined,
      salary: this.formatSalary(job.minAnnualSalary, job.maxAnnualSalary, job.minHourlyRate, job.maxHourlyRate) || undefined,
      location: this.buildLocation(coverage, job.timeZone, job.clientTimeZoneRestriction, job.overlapHours),
      tags: [
        this.normalizeJobType(job.jobType),
        job.jobRole ?? undefined,
        job.experienceLevel ?? undefined,
        ...coverage,
        ...(job.categories ?? []).map((category) => category.name).filter(Boolean) as string[],
      ].filter(Boolean) as string[],
      sourceFingerprint: `arc-${job.randomKey}`,
      sourceName: this.sourceName,
    }
  }

  private mapExternalJob(job: ArcExternalJob): RawJob {
    const coverage = this.summarizeCountryCodes(job.requiredCountries ?? [])
    const url = `https://arc.dev/remote-jobs/j/${job.urlString}-${job.randomKey}`

    return {
      title: job.title,
      company: job.company?.name?.trim() || 'Unknown',
      applyUrl: url,
      sourceUrl: url,
      description: this.joinMetadataLines([
        `Job type: ${this.normalizeJobType(job.jobType)}`,
        coverage.length > 0 ? `Eligible regions: ${coverage.join(', ')}` : null,
        job.requiredCountries?.length ? `Eligible country codes: ${job.requiredCountries.join(', ')}` : null,
        job.positionType ? `Role family: ${job.positionType}` : null,
        job.experienceLevels?.length ? `Experience levels: ${job.experienceLevels.join(', ')}` : null,
      ]),
      postedAt: job.postedAt ? new Date(job.postedAt * 1000).toISOString() : undefined,
      location: coverage.join(', ') || 'Remote',
      tags: [
        this.normalizeJobType(job.jobType),
        job.positionType ?? undefined,
        ...coverage,
        ...(job.experienceLevels ?? []),
        ...(job.categories ?? []).map((category) => category.name).filter(Boolean) as string[],
      ].filter(Boolean) as string[],
      sourceFingerprint: `arc-external-${job.randomKey}`,
      sourceName: this.sourceName,
    }
  }

  private normalizeJobType(value: string | null | undefined): string {
    if (!value) return 'Remote'
    if (value === 'contract') return 'Contract'
    if (value === 'permanent') return 'Full-time'
    return value
  }

  private formatSalary(
    minAnnualSalary?: number | null,
    maxAnnualSalary?: number | null,
    minHourlyRate?: number | null,
    maxHourlyRate?: number | null
  ): string | null {
    if (minAnnualSalary || maxAnnualSalary) {
      return `Salary: $${minAnnualSalary ?? 0} - $${maxAnnualSalary ?? minAnnualSalary ?? 0} per year`
    }
    if (minHourlyRate || maxHourlyRate) {
      return `Rate: $${minHourlyRate ?? 0} - $${maxHourlyRate ?? minHourlyRate ?? 0} per hour`
    }
    return null
  }

  private buildLocation(
    coverage: string[],
    timeZone?: string | null,
    clientTimeZoneRestriction?: string | null,
    overlapHours?: number | null
  ): string {
    const segments = [...coverage]
    if (timeZone) segments.push(timeZone)
    if (clientTimeZoneRestriction) segments.push(clientTimeZoneRestriction)
    if (overlapHours) segments.push(`${overlapHours}h overlap`)
    return segments.join(' / ') || 'Remote'
  }
}
