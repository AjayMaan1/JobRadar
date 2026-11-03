import * as cheerio from 'cheerio'
import { BaseAdapter } from './base.adapter.js'
import { createHash } from 'node:crypto'

function stableId(url: string): string {
  return createHash('sha1').update(url.trim().toLowerCase().replace(/[?#].*$/, '')).digest('hex').slice(0, 16)
}
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

export interface CheerioSelectors {
  container: string
  title: string
  company?: string
  link: string
  date?: string
  salary?: string
  location?: string
  tags?: string
}

export class GenericCheerioAdapter extends BaseAdapter {
  constructor(
    readonly sourceName: string,
    private selectors: CheerioSelectors,
    private baseUrl: string,
    private defaultLocation?: string
  ) {
    super()
  }

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const url = config.careersUrl ?? this.baseUrl
    const res = await this.fetchWithRetry(url, { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const $ = cheerio.load(html)
    const jobs: RawJob[] = []
    const sourceSlug = this.sourceName.toLowerCase().replace(/\s+/g, '-')
    const { container, title: titleSel, company: companySel, link: linkSel, date: dateSel, salary: salarySel, location: locSel } = this.selectors

    if ($(container).length === 0) {
      log.warn(`[CheerioAdapter:${this.sourceName}] 0 containers matched selector "${container}" on ${url} — selectors may be stale`)
    }

    $(container).each((_idx, el) => {
      const titleEl = $(el).find(titleSel)
      const titleText = titleEl.text().trim()
      if (!titleText) return

      const linkEl = $(el).find(linkSel)
      let href = linkEl.attr('href') ?? linkEl.closest('a').attr('href') ?? ''
      if (href && !href.startsWith('http')) {
        const base = new URL(this.baseUrl)
        href = `${base.origin}${href.startsWith('/') ? '' : '/'}${href}`
      }
      if (!href) return

      const company = companySel ? $(el).find(companySel).text().trim() || 'Unknown' : 'Unknown'
      const date = dateSel ? ($(el).find(dateSel).attr('datetime') ?? $(el).find(dateSel).text().trim()) : undefined
      const salary = salarySel ? $(el).find(salarySel).text().trim() : undefined
      const loc = locSel ? $(el).find(locSel).text().trim() : this.defaultLocation

      jobs.push({
        title: titleText,
        company,
        applyUrl: href,
        sourceUrl: href,
        description: '',
        postedAt: date || undefined,
        salary: salary || undefined,
        location: loc || undefined,
        tags: [],
        sourceFingerprint: `${sourceSlug}-${stableId(href)}`,
        sourceName: this.sourceName,
      })
    })

    return this.filterRelevantJobs(jobs)
  }
}
