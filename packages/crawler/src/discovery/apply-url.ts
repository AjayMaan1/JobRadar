import { atsRefFromUrl } from '../ats-urls.js'
import type { DiscoveryCandidate } from './types.js'

/**
 * Zero-cost discovery: every aggregator job whose apply URL points at an ATS board
 * tells us a company + board we can poll directly.
 */
export function candidateFromApplyUrl(companyName: string, applyUrl: string | null | undefined, sourceUrl?: string | null): DiscoveryCandidate | null {
  const ref = atsRefFromUrl(applyUrl) ?? atsRefFromUrl(sourceUrl)
  if (!ref) return null
  if (ref.ats === 'workday') return null // never auto-add unscoped workday boards
  return {
    source: 'aggregator_apply_url',
    externalRef: `${ref.ats}:${ref.slug}`,
    nameAsSeen: companyName,
    careersUrlAsSeen: ref.careersUrl,
    atsHint: ref.ats,
    slugHint: ref.slug,
    remoteHint: true,
  }
}
