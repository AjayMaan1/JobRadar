import { XMLParser } from 'fast-xml-parser'
import { BaseAdapter } from './base.adapter.js'
import { createHash } from 'node:crypto'

function stableId(url: string): string {
  return createHash('sha1').update(url.trim().toLowerCase().replace(/[?#].*$/, '')).digest('hex').slice(0, 16)
}
import type { RawJob, SourceConfig } from '../types.js'

interface RssItem {
  title?: string | { '#text'?: string }
  link?: string
  description?: string | { '#text'?: string }
  pubDate?: string
  'dc:date'?: string
  guid?: string | { '#text'?: string }
  author?: string
  'dc:creator'?: string
  category?: string | string[]
  'job:company'?: string
}

function str(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null && '#text' in (v as object)) {
    return String((v as Record<string, unknown>)['#text'] ?? '')
  }
  return String(v)
}

export class GenericRSSAdapter extends BaseAdapter {
  constructor(
    readonly sourceName: string,
    private readonly feedUrl: string,
    private readonly defaultLocation?: string
  ) {
    super()
  }

  async fetch(_config: SourceConfig): Promise<RawJob[]> {
    const res = await this.fetchWithRetry(this.feedUrl, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    })
    const xml = await res.text()

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
    })
    const parsed = parser.parse(xml)

    const channel = parsed?.rss?.channel ?? parsed?.feed ?? {}
    const rawItems: RssItem[] = channel.item ?? channel.entry ?? []
    const items = Array.isArray(rawItems) ? rawItems : [rawItems]

    const sourceSlug = this.sourceName.toLowerCase().replace(/\s+/g, '-')

    return this.filterRelevantJobs(items
      .filter((item) => str(item.title) && (str(item.link) || str(item.guid)))
      .map((item): RawJob => {
        const link = str(item.link) || str(item.guid)
        const company = str(item['job:company']) || str(item['dc:creator']) || str(item.author) || 'Unknown'
        const pubDate = item.pubDate ?? item['dc:date']
        const tags = Array.isArray(item.category)
          ? item.category.map(String)
          : item.category
          ? [String(item.category)]
          : []

        return {
          title: str(item.title).trim(),
          company: company.trim(),
          applyUrl: link.trim(),
          sourceUrl: link.trim(),
          description: str(item.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          postedAt: pubDate ? String(pubDate) : undefined,
          location: this.defaultLocation,
          tags,
          sourceFingerprint: `${sourceSlug}-${stableId(link)}`,
          sourceName: this.sourceName,
        }
      }))
  }
}
