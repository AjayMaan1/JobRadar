import { XMLParser } from 'fast-xml-parser'
import type { FetchGateway } from '../gateway/index.js'
import type { DiscoveryCandidate } from './types.js'

const FEEDS = [
  'https://techcrunch.com/category/venture/feed/',
  'https://techcrunch.com/category/startups/feed/',
]

const RAISE_RE = /^([A-Z][\w.&'-]+(?:\s+[A-Z][\w.&'-]+){0,3})\s+(?:raises|lands|secures|closes|nabs|bags)\s+\$?([\d.]+)\s*(m|million|b|billion)/i

/** Funding headlines → weak discovery hints ("Company raises $NM"). Resolver needs a careers URL later. */
export async function discoverFromFundingFeeds(gw: FetchGateway): Promise<DiscoveryCandidate[]> {
  const out: DiscoveryCandidate[] = []
  const parser = new XMLParser({ ignoreAttributes: false })
  for (const feed of FEEDS) {
    const res = await gw.fetch({ url: feed, purpose: 'discovery', quiet: true, kind: 'api' })
    if (res.outcome !== 'changed' || !res.body) continue
    let items: any[] = []
    try {
      const parsed = parser.parse(res.body)
      const raw = parsed?.rss?.channel?.item ?? []
      items = Array.isArray(raw) ? raw : [raw]
    } catch {
      continue
    }
    for (const it of items) {
      const title = String(it.title ?? '')
      const m = title.match(RAISE_RE)
      if (!m) continue
      const amount = parseFloat(m[2]) * (/b/i.test(m[3]) ? 1000 : 1)
      if (amount < 5) continue // < $5M rarely means a hiring wave
      const name = m[1].trim()
      out.push({
        source: 'funding_feed',
        externalRef: `${name.toLowerCase()}:${String(it.pubDate ?? '').slice(0, 16)}`,
        nameAsSeen: name,
        payload: { headline: title, amountM: amount, link: it.link, pubDate: it.pubDate },
        tagsHint: ['funded'],
      })
    }
  }
  return out
}
