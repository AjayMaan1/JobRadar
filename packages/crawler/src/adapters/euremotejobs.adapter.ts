import { XMLParser } from 'fast-xml-parser'
import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

interface RssItem {
  title?: string
  link?: string
  description?: string
  pubDate?: string
  guid?: string | { '#text'?: string }
}

export class EURemoteJobsAdapter extends BaseAdapter {
  readonly sourceName = 'EU Remote Jobs'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const res = await this.fetchWithRetry(config.apiUrl!, {
      headers: { Accept: 'application/rss+xml, text/xml, */*' },
    })
    if (res.status === 304) return []
    const xml = await res.text()

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const parsed = parser.parse(xml)

    const items: RssItem[] = parsed?.rss?.channel?.item ?? []
    const itemArray = Array.isArray(items) ? items : [items]

    return this.filterRelevantJobs(itemArray
      .filter((item) => item.title && item.link)
      .map((item): RawJob => {
        const guid =
          typeof item.guid === 'string'
            ? item.guid
            : item.guid?.['#text'] ?? item.link ?? ''
        const slug = guid.split('/').filter(Boolean).pop() ?? guid

        return {
          title: String(item.title ?? '').trim(),
          company: 'Unknown',
          applyUrl: String(item.link ?? '').trim(),
          sourceUrl: String(item.link ?? '').trim(),
          description: String(item.description ?? '').trim(),
          postedAt: item.pubDate,
          location: 'EMEA',
          tags: [],
          sourceFingerprint: `euremote-${slug}`,
          sourceName: this.sourceName,
        }
      }))
  }
}
