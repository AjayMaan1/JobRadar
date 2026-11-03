import type { FetchGateway } from './gateway/index.js'
import { atsRefFromUrl, atsRefsFromHtml, type AtsRef } from './ats-urls.js'

/**
 * Resolve a careers URL to ATS board references. Tries the URL itself first (free), then fetches the
 * page (HTML, robots-respecting, budgeted) and scans for embedded ATS links/scripts.
 */
export async function detectAts(url: string, gw: FetchGateway): Promise<AtsRef[]> {
  const direct = atsRefFromUrl(url)
  if (direct) return [direct]
  const res = await gw.fetch({ url, purpose: 'discovery', kind: 'html', headers: { Accept: 'text/html' }, timeoutMs: 20000 })
  if (res.outcome !== 'changed' || !res.body) return []
  return atsRefsFromHtml(res.body, url)
}
