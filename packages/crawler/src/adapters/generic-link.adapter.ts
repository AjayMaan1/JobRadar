import * as cheerio from 'cheerio'
import { BaseAdapter } from './base.adapter.js'
import { createHash } from 'node:crypto'

function stableId(url: string): string {
  return createHash('sha1').update(url.trim().toLowerCase().replace(/[?#].*$/, '')).digest('hex').slice(0, 16)
}
import type { RawJob, SourceConfig } from '../types.js'

const JOB_LINK_HINT = /\b(job|jobs|career|careers|opening|openings|vacancy|vacancies|position|positions|role|roles)\b/i

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function defaultLocation(config: SourceConfig): string | undefined {
  if (config.country) return config.country
  if (config.region) return config.region
  return undefined
}

export class GenericLinkAdapter extends BaseAdapter {
  readonly sourceName = 'Generic Career Page'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    if (!config.careersUrl) return []

    const res = await this.fetchWithRetry(config.careersUrl, {
      headers: { Accept: 'text/html' },
    })
    const html = await res.text()
    const $ = cheerio.load(html)
    const seen = new Set<string>()
    const jobs: RawJob[] = []
    const sourceSlug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    $('a[href]').each((_idx, el) => {
      const linkText = clean($(el).text())
      const ariaLabel = clean($(el).attr('aria-label') ?? '')
      const title = linkText || ariaLabel
      const hrefValue = $(el).attr('href')
      if (!title || !hrefValue) return

      const href = new URL(hrefValue, config.careersUrl!).toString()
      const context = `${title} ${href}`
      if (!JOB_LINK_HINT.test(context)) return
      if (seen.has(href)) return

      seen.add(href)
      jobs.push({
        title,
        company: config.name,
        applyUrl: href,
        sourceUrl: href,
        description: '',
        location: defaultLocation(config),
        tags: [],
        sourceFingerprint: `generic-${sourceSlug}-${stableId(href)}`,
        sourceName: config.name,
      })
    })

    return this.filterRelevantJobs(jobs).slice(0, 100)
  }
}
