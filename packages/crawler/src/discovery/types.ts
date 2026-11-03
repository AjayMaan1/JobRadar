import type { KnownAts } from '../ats-urls.js'

export type DiscoverySourceKind =
  | 'aggregator_apply_url' | 'hn_who_is_hiring' | 'github_list' | 'yc_directory'
  | 'himalayas_companies' | 'common_crawl' | 'funding_feed' | 'lca_dataset' | 'manual'

export interface DiscoveryCandidate {
  source: DiscoverySourceKind
  externalRef: string
  nameAsSeen?: string | null
  domainAsSeen?: string | null
  careersUrlAsSeen?: string | null
  atsHint?: KnownAts | null
  slugHint?: string | null
  hqCountryHint?: string | null
  tagsHint?: string[]
  remoteHint?: boolean | null
  payload?: Record<string, unknown>
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return h || null
  } catch {
    return null
  }
}
