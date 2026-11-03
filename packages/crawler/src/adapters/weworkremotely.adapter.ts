import { XMLParser } from 'fast-xml-parser'
import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

// WWR blocks plain HTTP scraping — HTML pages return empty body without a real browser.
// RSS feeds work without auth and contain full job data per category.
export class WeWorkRemotelyAdapter extends BaseAdapter {
  readonly sourceName = 'We Work Remotely'

  private readonly rssFeeds = [
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  ]

  async fetch(_config: SourceConfig): Promise<RawJob[]> {
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: false })
    const jobs: RawJob[] = []
    const seen = new Set<string>()

    for (const feedUrl of this.rssFeeds) {
      const res = await this.fetchWithRetry(feedUrl, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      })
      const xml = await res.text()
      const parsed = parser.parse(xml)
      const items = parsed?.rss?.channel?.item ?? []
      const itemList = Array.isArray(items) ? items : [items]

      for (const item of itemList) {
        const link: string = item.link ?? item.guid ?? ''
        if (!link || seen.has(link)) continue
        seen.add(link)

        // WWR titles are "Company: Job Title"
        const rawTitle: string = item.title ?? ''
        const colonIdx = rawTitle.indexOf(': ')
        const title = colonIdx !== -1 ? rawTitle.slice(colonIdx + 2).trim() : rawTitle.trim()
        const company = colonIdx !== -1 ? rawTitle.slice(0, colonIdx).trim() : 'Unknown'
        const region: string = item.region ?? 'Worldwide'
        const slug = link.split('/').filter(Boolean).pop() ?? link.slice(-20)

        if (!title) continue

        jobs.push({
          title,
          company,
          applyUrl: link,
          sourceUrl: link,
          description: '',
          postedAt: item.pubDate ? String(item.pubDate) : undefined,
          location: region,
          tags: item.category ? [String(item.category)] : [],
          sourceFingerprint: `wwr-${slug}`,
          sourceName: this.sourceName,
        })
      }
    }

    if (jobs.length === 0) {
      log.warn('[WWRAdapter] 0 jobs parsed — RSS feed may have changed format')
    }

    return this.filterRelevantJobs(jobs)
  }
}
