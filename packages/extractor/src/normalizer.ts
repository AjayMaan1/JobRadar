import { createHash } from 'node:crypto'
import type { ExtractedJob } from './deterministic.js'
import { toINR, toUSD, annualize } from './currency-converter.js'

/** Minimal source shape (works for aggregator Source rows and company boards). */
export interface NormalizeSource {
  name: string
  sourceType?: string | null
}

export interface NormalizedJob {
  title: string
  company: string
  sourceName: string
  sourceType: string | null
  sourceUrl: string | null
  applyUrl: string | null
  country: string | null
  region: string | null
  city: string | null
  remoteType: string
  eligibility: string
  eligibilityConfidence: number | null
  eligibilityEvidence: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  salaryConfidence: number | null
  salaryInrMin: number | null
  salaryInrMax: number | null
  /** USD pivot (v5 dynamic preferences). */
  salaryUsdMin: number | null
  salaryUsdMax: number | null
  experienceMin: number | null
  experienceMax: number | null
  seniority: string | null
  category: string | null
  skills: string[]
  description: string | null
  postedAt: Date | null
  sourceFingerprint: string | null
  canonicalHash: string
  /** Tracking-stripped, lowercased apply URL — primary cross-source identity. */
  applyUrlNormalized: string | null
}

function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ')
}

function buildLocationKey(location: string | undefined | null): string {
  if (!location) return 'unknown'

  const loc = normalize(location)

  if (/\b(worldwide|global|anywhere|work from anywhere)\b/.test(loc)) return 'global-remote'
  if (/\b(emea)\b/.test(loc)) return 'emea'
  if (/\b(apac|asia pacific)\b/.test(loc)) return 'apac'
  if (/\b(europe|european union)\b/.test(loc)) return 'europe'
  if (/\b(india)\b/.test(loc)) return 'india'
  if (/\b(united states|usa|u\.s\.)\b/.test(loc)) return 'us'
  if (/\b(united kingdom|uk)\b/.test(loc)) return 'uk'

  return loc
}

/**
 * Canonical identity = company | title | location key. `remoteType` was removed: it is derived from
 * free text that differs per source, which produced both duplicates and false merges.
 */
export function buildCanonicalHash(company: string, title: string, locationKey: string): string {
  const key = `${normalize(company)}|${normalize(title)}|${normalize(locationKey)}`
  return createHash('sha256').update(key).digest('hex')
}

export function normalizeApplyUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|gh_src$|gh_jid$|lever-source|src$|fbclid|gclid|_ga|mc_cid|mc_eid)/i.test(k)) u.searchParams.delete(k)
    }
    u.hash = ''
    let s = u.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s.toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

function inferCountryAndRegion(location: string | undefined | null): {
  country: string | null
  region: string | null
} {
  if (!location) return { country: null, region: null }
  const loc = location.toLowerCase()

  if (loc.includes('uae') || loc.includes('dubai') || loc.includes('united arab')) return { country: 'AE', region: 'UAE' }
  if (loc.includes('germany') || loc.includes('berlin')) return { country: 'DE', region: 'Europe' }
  if (loc.includes('austria') || loc.includes('vienna')) return { country: 'AT', region: 'Europe' }
  if (loc.includes('switzerland') || loc.includes('zurich')) return { country: 'CH', region: 'Europe' }
  if (loc.includes('netherlands') || loc.includes('amsterdam')) return { country: 'NL', region: 'Europe' }
  if (loc.includes('ireland') || loc.includes('dublin')) return { country: 'IE', region: 'Europe' }
  if (loc.includes('united kingdom') || /\buk\b/.test(loc) || loc.includes('london')) return { country: 'GB', region: 'UK' }
  if (loc.includes('united states') || loc.includes('usa') || loc.includes('u.s.')) return { country: 'US', region: 'US' }
  if (loc.includes('canada')) return { country: 'CA', region: 'Canada' }
  if (loc.includes('singapore')) return { country: 'SG', region: 'Singapore' }
  if (loc.includes('australia')) return { country: 'AU', region: 'Australia' }
  if (loc.includes('india')) return { country: 'IN', region: 'India' }
  if (loc.includes('emea')) return { country: null, region: 'EMEA' }
  if (loc.includes('europe')) return { country: null, region: 'Europe' }
  if (loc.includes('apac') || /\basia\b/.test(loc)) return { country: null, region: 'APAC' }
  if (loc.includes('worldwide') || loc.includes('anywhere') || loc.includes('global')) return { country: null, region: 'Global' }

  return { country: null, region: null }
}

const NON_CITY = /^(remote|hybrid|onsite|on-site|anywhere|worldwide|global|emea|apac|europe|india|usa?|united states|uk|united kingdom|canada|australia|germany|france|netherlands|singapore|uae)$/i

function inferCity(location: string | undefined | null): string | null {
  if (!location) return null
  const parts = location.split(/[,|/;()–-]+/).map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (NON_CITY.test(p)) continue
    if (/^[A-Za-z .'-]{3,40}$/.test(p) && !/\d/.test(p)) return p
  }
  return null
}

export function normalizeJob(extracted: ExtractedJob, source: NormalizeSource): NormalizedJob {
  const { country, region } = inferCountryAndRegion(extracted.location)
  const locationKey = country ?? region ?? buildLocationKey(extracted.location)

  let salaryInrMin: number | null = null
  let salaryInrMax: number | null = null
  let salaryUsdMin: number | null = null
  let salaryUsdMax: number | null = null

  if (extracted.salary) {
    const { min, max, currency, period } = extracted.salary
    const annualMin = annualize(min, period)
    const annualMax = annualize(max, period)
    salaryInrMin = toINR(annualMin, currency)
    salaryInrMax = toINR(annualMax, currency)
    salaryUsdMin = toUSD(annualMin, currency) || null
    salaryUsdMax = toUSD(annualMax, currency) || null
  }

  const canonicalHash = buildCanonicalHash(extracted.company, extracted.title, locationKey)

  let postedAt: Date | null = null
  if (extracted.postedAt) {
    const d = new Date(extracted.postedAt)
    if (!isNaN(d.getTime())) postedAt = d
  }

  return {
    title: extracted.title,
    company: extracted.company,
    sourceName: source.name,
    sourceType: source.sourceType ?? null,
    sourceUrl: extracted.sourceUrl ?? null,
    applyUrl: extracted.applyUrl,
    country,
    region,
    city: inferCity(extracted.location),
    remoteType: extracted.remoteType,
    eligibility: extracted.eligibility.eligibility,
    eligibilityConfidence: extracted.eligibility.confidence,
    eligibilityEvidence: extracted.eligibility.evidence.join(' | ') || null,
    salaryMin: extracted.salary?.min ?? null,
    salaryMax: extracted.salary?.max ?? null,
    salaryCurrency: extracted.salary?.currency ?? null,
    salaryPeriod: extracted.salary?.period ?? null,
    salaryConfidence: extracted.salary ? 0.85 : null,
    salaryInrMin,
    salaryInrMax,
    salaryUsdMin,
    salaryUsdMax,
    experienceMin: null,
    experienceMax: null,
    seniority: extracted.seniority ?? null,
    category: extracted.category ?? null,
    skills: extracted.tags,
    description: extracted.description || null,
    postedAt,
    sourceFingerprint: extracted.sourceFingerprint,
    canonicalHash,
    applyUrlNormalized: normalizeApplyUrl(extracted.applyUrl),
  }
}
