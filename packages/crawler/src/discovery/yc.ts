import type { FetchGateway } from '../gateway/index.js'
import { domainFromUrl, type DiscoveryCandidate } from './types.js'

interface YcCompany {
  id: number
  name: string
  slug: string
  website?: string
  all_locations?: string
  regions?: string[]
  isHiring?: boolean
  tags?: string[]
  team_size?: number
  status?: string
  batch?: string
}

/**
 * YC directory via the yc-oss static mirror (GitHub Pages, public JSON). Only companies flagged
 * isHiring with a remote/global region or no region are emitted.
 */
export async function discoverFromYc(gw: FetchGateway): Promise<DiscoveryCandidate[]> {
  const { data } = await gw.json<YcCompany[]>({ url: 'https://yc-oss.github.io/api/companies/all.json', purpose: 'discovery', quiet: true, timeoutMs: 60000 })
  if (!data) return []
  const out: DiscoveryCandidate[] = []
  for (const c of data) {
    if (!c.isHiring || c.status === 'Inactive' || c.status === 'Acquired') continue
    const regions = (c.regions ?? []).map((r) => r.toLowerCase())
    const loc = (c.all_locations ?? '').toLowerCase()
    const remote = regions.some((r) => /remote/.test(r)) || /remote/.test(loc)
    const indiaHq = regions.includes('india') || /\bindia\b/.test(loc) && !remote
    out.push({
      source: 'yc_directory',
      externalRef: c.slug,
      nameAsSeen: c.name,
      domainAsSeen: domainFromUrl(c.website),
      careersUrlAsSeen: `https://www.ycombinator.com/companies/${c.slug}/jobs`,
      hqCountryHint: indiaHq ? 'IN' : regions.some((r) => /america|united states/.test(r)) ? 'US' : regions.some((r) => /europe/.test(r)) ? 'EU' : null,
      remoteHint: remote,
      tagsHint: ['yc', ...(c.tags ?? []).slice(0, 5).map((t) => t.toLowerCase())],
      payload: { batch: c.batch, teamSize: c.team_size, regions: c.regions, locations: c.all_locations },
    })
  }
  return out
}
