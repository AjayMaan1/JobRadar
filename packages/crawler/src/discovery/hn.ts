import type { FetchGateway } from '../gateway/index.js'
import { atsRefFromUrl } from '../ats-urls.js'
import { domainFromUrl, type DiscoveryCandidate } from './types.js'

interface AlgoliaHit { objectID: string; title: string; created_at: string }
interface HnItem { id: number; text?: string; children?: HnItem[]; deleted?: boolean; dead?: boolean }

const RESTRICTION_RE = /\b(us[- ]only|usa[- ]only|u\.s\. only|eu[- ]only|uk[- ]only|europe[- ]only|(?:north )?america[- ]only|canada[- ]only|must be (?:located|based) in|(?:residents?|citizens?) of the (?:us|uk|eu))\b/i
const INDIA_OK_RE = /\b(worldwide|anywhere|global|india|apac|asia|utc\s*\+\s*[3-8]|any ?where in the world|all time ?zones|async)\b/i

function stripHtml(s: string): string {
  return s.replace(/<p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/[ \t]+/g, ' ').trim()
}

/**
 * Hacker News "Who is hiring?" (monthly). Official Algolia API. Each top-level comment is one company.
 * Header convention: "Company | Role(s) | Location | REMOTE | ..." — we keep comments mentioning REMOTE.
 */
export async function discoverFromHn(gw: FetchGateway, opts: { maxThreads?: number } = {}): Promise<DiscoveryCandidate[]> {
  const out: DiscoveryCandidate[] = []
  const { data: search } = await gw.json<{ hits: AlgoliaHit[] }>({
    url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=%22who%20is%20hiring%22&hitsPerPage=6',
    purpose: 'discovery',
    quiet: true,
  })
  const threads = (search?.hits ?? []).filter((h) => /who is hiring/i.test(h.title)).slice(0, opts.maxThreads ?? 2)
  for (const t of threads) {
    const { data: item } = await gw.json<HnItem>({ url: `https://hn.algolia.com/api/v1/items/${t.objectID}`, purpose: 'discovery', quiet: true, timeoutMs: 60000 })
    for (const c of item?.children ?? []) {
      if (!c.text || c.deleted || c.dead) continue
      const text = stripHtml(c.text)
      const header = text.split('\n')[0] ?? ''
      if (!/\bremote\b/i.test(header) && !/\bremote\b/i.test(text.slice(0, 400))) continue
      const parts = header.split('|').map((p) => p.trim()).filter(Boolean)
      const name = parts[0]?.replace(/\(.*?\)/g, '').trim()
      if (!name || name.length > 80) continue
      const urls = [...text.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''))
      const atsUrl = urls.map((u) => ({ u, ref: atsRefFromUrl(u) })).find((x) => x.ref && x.ref.ats !== 'workday')
      const careers = atsUrl?.u ?? urls.find((u) => /career|jobs|hiring|join/i.test(u)) ?? urls[0] ?? null
      const restricted = RESTRICTION_RE.test(text) && !INDIA_OK_RE.test(text)
      out.push({
        source: 'hn_who_is_hiring',
        externalRef: `${t.objectID}:${c.id}`,
        nameAsSeen: name,
        domainAsSeen: domainFromUrl(careers && !atsUrl ? careers : urls.find((u) => !atsRefFromUrl(u)) ?? null),
        careersUrlAsSeen: careers,
        atsHint: atsUrl?.ref?.ats ?? null,
        slugHint: atsUrl?.ref?.slug ?? null,
        remoteHint: !restricted,
        payload: { header, thread: t.title, snippet: text.slice(0, 600), restricted },
      })
    }
  }
  return out
}
